"""End-to-end: extract -> validate -> post against the real KvizHub application (part A).

The language model steps (writing questions, blind solving) are replaced by fixtures/quiz.json.
Skipped when Node.js / the monorepo dependencies are not available.
"""
import json
import os
import shutil
import socket
import subprocess
import time
import urllib.request
from pathlib import Path

import pytest

import extract
import post_quiz
import validate_quiz

SKILL = Path(__file__).resolve().parents[1]
REPO = SKILL.parents[1]
FIX = SKILL / "fixtures"

pytestmark = pytest.mark.skipif(
    shutil.which("npx") is None or not (REPO / "node_modules").exists(),
    reason="Node.js nebo závislosti monorepa nejsou k dispozici",
)


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture(scope="module")
def app(tmp_path_factory):
    port = free_port()
    db = tmp_path_factory.mktemp("db") / "kvizhub.db"
    env = {
        **os.environ,
        "APP_PORT": str(port),
        "BIND_ADDR": "127.0.0.1",
        "PUBLIC_URL": f"http://127.0.0.1:{port}",
        "DB_PATH": str(db),
        "SESSION_SECRET": "x" * 40,
        "LOG_LEVEL": "warn",
    }
    proc = subprocess.Popen(["npx", "tsx", "apps/server/src/index.ts"], cwd=REPO, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    url = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            urllib.request.urlopen(f"{url}/healthz", timeout=1)
            break
        except OSError:
            time.sleep(0.2)
    else:
        proc.kill()
        pytest.fail("KvizHub se nespustil: " + proc.stderr.read().decode()[-2000:])
    # teacher + API token through the UI endpoints
    req = urllib.request.Request(f"{url}/api/auth/register", data=json.dumps({"email": "agent-test@skola.cz", "password": "heslo-pro-test-123"}).encode(), headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req) as r:
        csrf = json.loads(r.read())["csrfToken"]
        cookie = r.headers["Set-Cookie"].split(";")[0]
    req = urllib.request.Request(f"{url}/api/tokens", data=json.dumps({"name": "agent"}).encode(), headers={"Content-Type": "application/json", "Cookie": cookie, "X-CSRF-Token": csrf}, method="POST")
    with urllib.request.urlopen(req) as r:
        token = json.loads(r.read())["token"]
    yield {"url": url, "token": token}
    proc.terminate()
    proc.wait(timeout=10)


def test_extract_validate_post(app, tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("KVIZHUB_URL", app["url"])
    monkeypatch.setenv("KVIZHUB_TOKEN", app["token"])
    work = tmp_path / "work"
    work.mkdir()

    # 2) extraction
    assert extract.main([str(FIX / "optika.docx"), "--out", str(work / "sections.json")]) == 0
    sections = json.loads((work / "sections.json").read_text(encoding="utf-8"))
    capsys.readouterr()

    # 4) "generation": the sample quiz, with the real file hash filled in like the agent would
    quiz = json.loads((FIX / "quiz.json").read_text(encoding="utf-8"))
    quiz["sourceFiles"] = [{"name": f["name"], "sha256": f["sha256"]} for f in sections["files"]]
    (work / "quiz.json").write_text(json.dumps(quiz, ensure_ascii=False), encoding="utf-8")

    # 5) checks
    assert validate_quiz.main([str(work / "sections.json"), str(work / "quiz.json"), "--out", str(work / "quiz.checked.json")]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["toFix"] == []

    # 7) dry run, then for real
    assert post_quiz.main([str(work / "quiz.checked.json"), "--dry-run"]) == 0
    assert json.loads(capsys.readouterr().out) == {"valid": True, "stats": {"total": 8, "ok": 7, "flagged": 1}}
    assert post_quiz.main([str(work / "quiz.checked.json"), "--params", "8 otázek, 8. ročník"]) == 0
    created = json.loads(capsys.readouterr().out)
    assert created["reviewUrl"] == f"{app['url']}/quizzes/{created['quizId']}"
    # running again does not create a duplicate (Idempotency-Key)
    assert post_quiz.main([str(work / "quiz.checked.json"), "--params", "8 otázek, 8. ročník"]) == 0
    assert json.loads(capsys.readouterr().out)["quizId"] == created["quizId"]

    # 9) start a game and read results
    assert post_quiz.main(["--game", created["quizId"]]) == 0
    game = json.loads(capsys.readouterr().out)
    assert game["pin"].isdigit() and len(game["pin"]) == 6
    assert game["hostUrl"].startswith(f"{app['url']}/host/")
    assert game["questionCount"] == 7  # the flagged question is skipped
    assert post_quiz.main(["--results", game["gameId"]]) == 0
    res = json.loads(capsys.readouterr().out)
    assert res["summary"]["playerCount"] == 0

    # the agent token can never approve flagged questions
    quiz_json = json.loads(urllib.request.urlopen(urllib.request.Request(f"{app['url']}/api/v1/quizzes/{created['quizId']}", headers={"Authorization": f"Bearer {app['token']}"})).read())
    flagged = next(q for q in quiz_json["questions"] if q["qa"]["status"] == "flagged")
    req = urllib.request.Request(f"{app['url']}/api/v1/quizzes/{created['quizId']}/questions/{flagged['id']}/approve", method="POST", headers={"Authorization": f"Bearer {app['token']}"})
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.urlopen(req)
    assert e.value.code == 403

    # 10) clean-up of the work directory
    shutil.rmtree(work)
    assert not work.exists()


def test_422_roundtrip_with_real_server(app, tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("KVIZHUB_URL", app["url"])
    monkeypatch.setenv("KVIZHUB_TOKEN", app["token"])
    quiz = json.loads((FIX / "quiz.json").read_text(encoding="utf-8"))
    quiz["questions"][0]["correctIndices"] = [9]
    p = tmp_path / "bad.json"
    p.write_text(json.dumps(quiz, ensure_ascii=False), encoding="utf-8")
    assert post_quiz.main([str(p)]) == 2
    out = json.loads(capsys.readouterr().out)
    assert out["errors"][0] == {"path": "questions[0].correctIndices[0]", "code": "out_of_range", "message": "Index 9 je mimo rozsah možností."}
