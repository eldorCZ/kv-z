import json
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

import post_quiz

FIX = Path(__file__).resolve().parents[1] / "fixtures"
TOKEN = "khp_SUPER_SECRET_TOKEN_123"


class Mock:
    """Serves a queue of (status, body, headers) responses and records requests."""

    def __init__(self):
        self.queue: list[tuple[int, object, dict]] = []
        self.requests: list[dict] = []
        mock = self

        class Handler(BaseHTTPRequestHandler):
            def _handle(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length else b""
                mock.requests.append({"method": self.command, "path": self.path, "headers": dict(self.headers), "body": json.loads(body) if body else None})
                status, payload, headers = mock.queue.pop(0) if mock.queue else (500, {"error": "no response queued"}, {})
                data = json.dumps(payload).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                for k, v in headers.items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            do_GET = do_POST = _handle

            def log_message(self, *a):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()


@pytest.fixture()
def mock(monkeypatch):
    m = Mock()
    monkeypatch.setenv("KVIZHUB_URL", m.url)
    monkeypatch.setenv("KVIZHUB_TOKEN", TOKEN)
    monkeypatch.setenv("KVIZHUB_RETRY_BASE", "0.01")
    monkeypatch.setenv("KVIZHUB_RETRY_AFTER_SCALE", "0.01")
    yield m
    m.close()


def run(capsys, *args):
    code = post_quiz.main([*args])
    out, err = capsys.readouterr()
    assert TOKEN not in out and TOKEN not in err
    return code, out, err


QUIZ = str(FIX / "quiz.json")


def test_dry_run_200(mock, capsys):
    mock.queue.append((200, {"valid": True, "stats": {"total": 8, "ok": 7, "flagged": 1}}, {}))
    code, out, _ = run(capsys, QUIZ, "--dry-run")
    assert code == 0
    assert json.loads(out)["valid"] is True
    req = mock.requests[0]
    assert req["path"] == "/api/v1/quizzes?dry_run=1"
    assert req["headers"]["Authorization"] == f"Bearer {TOKEN}"


def test_created_201_with_idempotency_key(mock, capsys):
    body = {"quizId": "q1", "reviewUrl": "http://x/quizzes/q1", "stats": {"total": 8, "ok": 7, "flagged": 1}}
    mock.queue += [(201, body, {}), (201, body, {})]
    code, out, _ = run(capsys, QUIZ, "--params", "8 otázek")
    assert code == 0 and json.loads(out) == body
    run(capsys, QUIZ, "--params", "8 otázek")
    k1, k2 = (r["headers"]["Idempotency-Key"] for r in mock.requests)
    assert k1 == k2 and len(k1) == 64  # same sources + params -> same key -> no duplicate quiz


def test_409_conflict(mock, capsys):
    mock.queue.append((409, {"error": "Stejný Idempotency-Key už byl použit s jiným obsahem."}, {}))
    code, _, err = run(capsys, QUIZ)
    assert code == 1
    assert "409" in err and "--new-key" in err


def test_422_prints_errors_exit_2(mock, capsys):
    errors = [{"path": "questions[3].correctIndices", "code": "out_of_range", "message": "Index 5 je mimo rozsah možností."}]
    mock.queue.append((422, {"errors": errors}, {}))
    code, out, _ = run(capsys, QUIZ)
    assert code == 2
    assert json.loads(out) == {"errors": errors}
    assert len(mock.requests) == 1  # 4xx is not retried


def test_429_is_retried(mock, capsys):
    mock.queue += [(429, {"error": "Příliš mnoho požadavků"}, {"Retry-After": "1"}), (201, {"quizId": "q2", "reviewUrl": "u", "stats": {}}, {})]
    code, out, _ = run(capsys, QUIZ)
    assert code == 0 and json.loads(out)["quizId"] == "q2"
    assert len(mock.requests) == 2


def test_500_retried_three_times_then_error(mock, capsys):
    mock.queue += [(500, {"error": "Interní chyba"}, {})] * 3
    code, _, err = run(capsys, QUIZ)
    assert code == 1
    assert len(mock.requests) == 3
    assert "500" in err


def test_500_then_success(mock, capsys):
    mock.queue += [(503, {"error": "x"}, {}), (201, {"quizId": "q3", "reviewUrl": "u", "stats": {}}, {})]
    code, _, _ = run(capsys, QUIZ)
    assert code == 0


def test_connection_refused(monkeypatch, capsys):
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    monkeypatch.setenv("KVIZHUB_URL", f"http://127.0.0.1:{port}")
    monkeypatch.setenv("KVIZHUB_TOKEN", TOKEN)
    monkeypatch.setenv("KVIZHUB_RETRY_BASE", "0.01")
    code, _, err = run(capsys, QUIZ)
    assert code == 1
    assert "neodpovídá" in err


def test_missing_env(monkeypatch, capsys):
    monkeypatch.delenv("KVIZHUB_URL", raising=False)
    monkeypatch.setenv("KVIZHUB_TOKEN", TOKEN)
    code, _, err = run(capsys, QUIZ)
    assert code == 1 and "KVIZHUB_URL" in err


def test_error_bodies_never_echo_the_token(mock, capsys):
    mock.queue.append((401, {"error": f"token {TOKEN} je neplatný"}, {}))
    code, _, err = run(capsys, QUIZ)
    assert code == 1 and "***" in err


def test_refuses_quiz_with_unverified_quote(mock, tmp_path, capsys):
    quiz = json.loads((FIX / "quiz.json").read_text(encoding="utf-8"))
    quiz["questions"][0]["qa"] = {"status": "flagged", "notes": "Citace nenalezena ve zdroji."}
    p = tmp_path / "q.json"
    p.write_text(json.dumps(quiz, ensure_ascii=False), encoding="utf-8")
    code, out, _ = run(capsys, str(p))
    assert code == 2 and json.loads(out)["questions"] == [1]
    assert mock.requests == []


def test_game_and_results(mock, capsys):
    mock.queue.append((201, {"gameId": "g1", "pin": "482913", "joinUrl": "https://k/play", "hostUrl": "https://k/host/g1#key=abc", "questionCount": 7}, {}))
    code, out, _ = run(capsys, "--game", "q1")
    assert code == 0
    assert json.loads(out)["pin"] == "482913"
    assert mock.requests[-1]["path"] == "/api/v1/quizzes/q1/games"
    assert mock.requests[-1]["body"]["mode"] == "live"
    mock.queue.append(
        (
            200,
            {
                "playerCount": 3,
                "ranking": [{"nickname": "A", "score": 900, "rank": 1}, {"nickname": "B", "score": 500, "rank": 2}, {"nickname": "C", "score": 0, "rank": 3}],
                "perQuestion": [
                    {"questionId": "x", "number": 1, "prompt": "P1", "answered": 3, "correct": 3, "successRate": 1.0, "avgTimeMs": 1000},
                    {"questionId": "y", "number": 2, "prompt": "P2", "answered": 3, "correct": 1, "successRate": 0.333, "avgTimeMs": 2000},
                ],
            },
            {},
        )
    )
    code, out, _ = run(capsys, "--results", "g1")
    res = json.loads(out)
    assert code == 0
    assert res["summary"]["hardest"][0] == {"number": 2, "percent": 33, "prompt": "P2"}
    assert res["summary"]["top5"][0] == {"nickname": "A", "score": 900}


def test_game_409_all_flagged(mock, capsys):
    mock.queue.append((409, {"error": "Kvíz nemá žádnou hratelnou otázku"}, {}))
    code, _, err = run(capsys, "--game", "q1")
    assert code == 1 and "hratelnou" in err


def test_create_test_and_results_without_names(mock, capsys):
    mock.queue.append((201, {"gameId": "t1", "mode": "test", "pin": "123456", "joinUrl": "https://k/play", "qrUrl": "https://k/play?pin=123456", "dashboardUrl": "https://k/tests/t1", "questionCount": 8, "closesAt": "2026-10-02T16:00:00Z"}, {}))
    code, out, _ = run(capsys, "--game", "q1", "--mode", "test", "--time-limit", "25", "--show-results", "full")
    assert code == 0
    assert json.loads(out)["dashboardUrl"] == "https://k/tests/t1"
    assert mock.requests[-1]["body"] == {"mode": "test", "settings": {"test": {"timeLimitMin": 25, "showResultsToStudent": "full"}}}
    mock.queue.append(
        (
            200,
            {
                "mode": "test",
                "status": "finished",
                "summary": {"students": 3, "submitted": 3, "avgPercent": 70, "medianPercent": 75, "leaveFlagged": 1},
                "students": [{"student": "Jana Nováková", "percent": 100}],
                "perQuestion": [{"number": 1, "prompt": "P1", "successRate": 0.9}, {"number": 2, "prompt": "P2", "successRate": 0.2}],
            },
            {},
        )
    )
    code, out, _ = run(capsys, "--results", "t1")
    res = json.loads(out)
    assert code == 0
    assert res["summary"]["hardest"][0] == {"number": 2, "percent": 20, "prompt": "P2"}
    assert res["summary"]["leaveFlagged"] == 1
    assert "Jana" not in out and "students" not in res


def test_create_test_with_leave_guard(mock, capsys):
    mock.queue.append((201, {"gameId": "t2", "mode": "test", "pin": "1", "joinUrl": "j", "dashboardUrl": "d", "questionCount": 2}, {}))
    code, _, _ = run(capsys, "--game", "q1", "--mode", "test", "--leave-guard", "warn", "--max-leaves", "1", "--on-exceed", "lock", "--fullscreen")
    assert code == 0
    assert mock.requests[-1]["body"]["settings"]["test"]["leaveGuard"] == {"mode": "warn", "maxLeaves": 1, "onExceed": "lock", "requireFullscreen": True}


# ---------------------------------------------------------------- classes (Dodatek 3)

NAMES = ["novak12", "K7MQ-2XRT"]


def test_classes_whitelist(mock, capsys):
    mock.queue.append((200, {"classes": [{"id": "c1", "name": "8.A Fyzika", "schoolYear": "2026/2027", "subject": "Fyzika", "status": "active", "activeStudents": 24, "students": [{"accountName": "novak12"}]}]}, {}))
    code, out, _ = run(capsys, "--classes")
    assert code == 0
    assert json.loads(out) == {"classes": [{"id": "c1", "name": "8.A Fyzika", "schoolYear": "2026/2027", "subject": "Fyzika", "status": "active", "activeStudents": 24}]}
    assert "novak12" not in out
    assert mock.requests[0]["path"] == "/api/v1/classes"


def test_class_game(mock, capsys):
    mock.queue.append((201, {"gameId": "g1", "mode": "test", "pin": "482913", "joinUrl": "http://x/join/482913", "hostUrl": "http://x/host/g1#key=abc", "dashboardUrl": "http://x/tests/g1", "questionCount": 10}, {}))
    code, out, _ = run(capsys, "--game", "q1", "--mode", "test", "--time-limit", "20", "--class", "c1", "--label", "Písemka 2", "--allow-guests", "--no-stats")
    assert code == 0
    body = mock.requests[0]["body"]
    assert body == {"mode": "test", "settings": {"test": {"timeLimitMin": 20}, "classId": "c1", "label": "Písemka 2", "allowGuests": True, "countInStats": False}}
    assert json.loads(out)["pin"] == "482913"


def test_class_game_defaults_live(mock, capsys):
    mock.queue.append((201, {"gameId": "g1", "pin": "1", "joinUrl": "j", "hostUrl": "h", "questionCount": 3}, {}))
    run(capsys, "--game", "q1", "--class", "c1")
    assert mock.requests[0]["body"] == {"mode": "live", "settings": {"showLeaderboard": True, "classId": "c1"}}


@pytest.mark.parametrize("status,msg", [(404, "Třída nenalezena."), (409, "Třída je archivovaná."), (422, None)])
def test_class_game_errors(mock, capsys, status, msg):
    mock.queue.append((status, {"error": msg} if msg else {"errors": [{"path": "settings.label", "code": "too_big", "message": "Příliš dlouhé."}]}, {}))
    code, out, err = run(capsys, "--game", "q1", "--class", "c1", "--label", "x")
    if status == 422:
        assert code == 2 and json.loads(out)["errors"][0]["path"] == "settings.label"
    else:
        assert code == 1 and msg in err


def test_class_flags_need_class(capsys):
    with pytest.raises(SystemExit):
        post_quiz.main(["--game", "q1", "--label", "x"])
    with pytest.raises(SystemExit):
        post_quiz.main(["--class", "c1"])


def test_makeup(mock, capsys):
    mock.queue.append((201, {"gameId": "g2", "pin": "111222", "joinUrl": "j", "hostUrl": "h", "resultsUrl": "r", "audienceSize": 2, "reused": False, "audience": ["s1"]}, {}))
    code, out, _ = run(capsys, "--makeup", "c1", "a1")
    assert code == 0
    assert mock.requests[0]["method"] == "POST" and mock.requests[0]["path"] == "/api/v1/classes/c1/activities/a1/makeup"
    data = json.loads(out)
    assert data["audienceSize"] == 2 and "audience" not in data


def test_makeup_reused_and_conflict(mock, capsys):
    mock.queue.append((200, {"gameId": "g2", "pin": "1", "joinUrl": "j", "hostUrl": "h", "resultsUrl": "r", "audienceSize": 2, "reused": True}, {}))
    code, out, _ = run(capsys, "--makeup", "c1", "a1")
    assert code == 0 and json.loads(out)["reused"] is True
    mock.queue.append((409, {"error": "Nikdo z třídy v tomto testu nechybí."}, {}))
    code, _, err = run(capsys, "--makeup", "c1", "a1")
    assert code == 1 and "nechybí" in err


def test_class_summary_whitelist(mock, capsys):
    mock.queue.append(
        (
            200,
            {
                "className": "8.A",
                "period": {"from": "2026-09-01", "to": None},
                "activeStudents": 24,
                "testAvg": 68,
                "quizAvg": 72,
                "participationRate": 92,
                "activities": [{"activityId": "a1", "label": "Test 1", "kind": "test", "playedAt": "2026-09-10", "n": 23, "participationRate": 96, "avgPercent": 68, "medianPercent": 70, "students": ["novak12"]}],
                "weakTopics": [{"topic": "Lom světla", "successRate": 54, "items": 120}],
                "weakQuestions": [{"quizId": "q1", "questionId": "x", "prompt": "Co je lom?", "successRate": 30, "answers": 23}],
                "notes": [],
                "students": [{"accountName": "novak12", "code": "K7MQ-2XRT"}],
            },
            {},
        )
    )
    code, out, _ = run(capsys, "--class-summary", "c1", "--from", "2026-09-01")
    assert code == 0
    assert mock.requests[0]["path"] == "/api/v1/classes/c1/summary?from=2026-09-01"
    for word in NAMES:
        assert word not in out
    data = json.loads(out)
    assert data["weakTopics"][0]["topic"] == "Lom světla"
    assert "students" not in data and "students" not in data["activities"][0]


def test_class_summary_small_group(mock, capsys):
    mock.queue.append((200, {"className": "Malá", "testAvg": None, "quizAvg": None, "participationRate": None, "activities": [], "weakTopics": [], "weakQuestions": [], "notes": ["malá skupina: třída má méně než 5 aktivních žáků"]}, {}))
    code, out, _ = run(capsys, "--class-summary", "c1")
    assert code == 0 and json.loads(out)["notes"][0].startswith("malá skupina")


@pytest.mark.parametrize("status", [404, 403])
def test_class_summary_errors(mock, capsys, status):
    mock.queue.append((status, {"error": "Třída nenalezena." if status == 404 else "API token nemá oprávnění classes:read."}, {}))
    code, _, err = run(capsys, "--class-summary", "c1")
    assert code == 1 and "KvizHub vrátil" in err


def test_class_summary_retries_429_and_500(mock, capsys):
    mock.queue += [(429, {"error": "slow down"}, {"Retry-After": "1"}), (500, {"error": "boom"}, {}), (200, {"className": "8.A", "activities": []}, {})]
    code, out, _ = run(capsys, "--class-summary", "c1")
    assert code == 0 and len(mock.requests) == 3


def test_class_summary_outage(monkeypatch, capsys):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    monkeypatch.setenv("KVIZHUB_URL", f"http://127.0.0.1:{port}")
    monkeypatch.setenv("KVIZHUB_TOKEN", TOKEN)
    monkeypatch.setenv("KVIZHUB_RETRY_BASE", "0.01")
    code, _, err = run(capsys, "--class-summary", "c1")
    assert code == 1 and "neodpovídá" in err


def test_topics(mock, capsys):
    mock.queue.append((200, {"topics": ["Lom světla", "Zrcadla"]}, {}))
    code, out, _ = run(capsys, "--topics")
    assert code == 0 and json.loads(out)["topics"] == ["Lom světla", "Zrcadla"]


# ---------- look (Dodatek 4, V7.4) ----------


def test_quiz_without_look_sends_no_theme(mock, capsys):
    mock.queue.append((201, {"quizId": "q1", "reviewUrl": "u", "stats": {}}, {}))
    run(capsys, QUIZ)
    assert "theme" not in mock.requests[0]["body"]  # the agent never picks a look on its own


def test_quiz_with_motive_and_accent_and_warnings(mock, capsys):
    warn = [{"path": "theme.motive", "code": "unknown_motive", "message": "Neznámý motiv \"x\" byl ignorován."}]
    mock.queue.append((201, {"quizId": "q1", "reviewUrl": "u", "stats": {}, "warnings": warn}, {}))
    code, out, _ = run(capsys, QUIZ, "--motive", "vesmir", "--accent", "modra")
    assert code == 0
    assert mock.requests[0]["body"]["theme"] == {"motive": "vesmir", "accent": "modra"}
    assert json.loads(out)["warnings"] == warn


def test_game_with_motive_only_for_this_game(mock, capsys):
    mock.queue.append((201, {"gameId": "g1", "pin": "1", "joinUrl": "j", "hostUrl": "h", "questionCount": 3}, {}))
    run(capsys, "--game", "q1", "--motive", "papir")
    assert mock.requests[0]["body"] == {"mode": "live", "settings": {"showLeaderboard": True, "theme": {"motive": "papir"}}}


def test_themes_list(mock, capsys):
    mock.queue.append((200, [{"id": "papir", "name": "Papír", "category": "klidne", "calm": True}], {}))
    code, out, _ = run(capsys, "--themes")
    assert code == 0 and json.loads(out)["themes"][0]["id"] == "papir"
    assert mock.requests[0]["path"] == "/api/v1/themes"


def test_motive_needs_quiz_or_game(mock, capsys):
    with pytest.raises(SystemExit):
        post_quiz.main(["--results", "g1", "--motive", "les"])
