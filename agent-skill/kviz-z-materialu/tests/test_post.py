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
