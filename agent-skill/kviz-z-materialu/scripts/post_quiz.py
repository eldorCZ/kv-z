#!/usr/bin/env python3
"""Send a checked quiz to KvizHub, create games and read results.

Usage:
  python post_quiz.py quiz.checked.json [--dry-run] [--params "15 otázek, 8. ročník"] [--new-key]
  python post_quiz.py --game <quizId> [--mode live] [--leaderboard/--no-leaderboard]
  python post_quiz.py --results <gameId>

Address and token come ONLY from the environment: KVIZHUB_URL, KVIZHUB_TOKEN. The token is never printed.
Exit codes: 0 success (JSON on stdout), 2 validation errors (422 list on stdout) or refused input, 1 other error (Czech message on stderr).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

MAX_ATTEMPTS = 3
TIMEOUT_S = 30
BLOCKING_NOTE = "citace nenalezena ve zdroji"


class ApiFailure(Exception):
    def __init__(self, message: str, status: int = 0, body: object = None):
        super().__init__(message)
        self.status = status
        self.body = body


def env_config() -> tuple[str, str]:
    url = os.environ.get("KVIZHUB_URL", "").strip().rstrip("/")
    token = os.environ.get("KVIZHUB_TOKEN", "").strip()
    if not url:
        raise ApiFailure("Chybí proměnná prostředí KVIZHUB_URL (adresa KvizHubu, např. http://127.0.0.1:3000).")
    if not token:
        raise ApiFailure("Chybí proměnná prostředí KVIZHUB_TOKEN (API token vytvořený v KvizHubu v Nastavení → API tokeny).")
    return url, token


def redact(text: str, token: str) -> str:
    return text.replace(token, "***") if token else text


def request(method: str, path: str, body: object | None = None, headers: dict | None = None) -> tuple[int, dict, object]:
    """HTTP call with retry on 429, 5xx and connection errors (exponential backoff, max 3 attempts)."""
    url, token = env_config()
    base_delay = float(os.environ.get("KVIZHUB_RETRY_BASE", "1"))
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    hdrs = {"Authorization": f"Bearer {token}", "Accept": "application/json", **(headers or {})}
    if data is not None:
        hdrs["Content-Type"] = "application/json; charset=utf-8"
    last: ApiFailure | None = None
    for attempt in range(MAX_ATTEMPTS):
        if attempt:
            time.sleep(base_delay * (2 ** (attempt - 1)))
        req = urllib.request.Request(f"{url}/api/v1{path}", data=data, method=method, headers=hdrs)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as res:  # noqa: S310 – URL comes from the operator's environment
                raw = res.read()
                return res.status, dict(res.headers), json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                payload = json.loads(raw) if raw else None
            except json.JSONDecodeError:
                payload = {"error": redact(raw.decode("utf-8", "replace")[:300], token)}
            if e.code == 429 or e.code >= 500:
                retry_after = e.headers.get("Retry-After")
                last = ApiFailure(f"Server vrátil {e.code}.", e.code, payload)
                if retry_after and retry_after.isdigit() and attempt + 1 < MAX_ATTEMPTS:
                    time.sleep(min(int(retry_after), 60) * float(os.environ.get("KVIZHUB_RETRY_AFTER_SCALE", "1")))
                continue
            return e.code, dict(e.headers), payload
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            reason = getattr(e, "reason", e)
            last = ApiFailure(redact(f"Aplikace KvizHub neodpovídá ({reason}).", token))
            continue
    assert last is not None
    if last.status == 429:
        raise ApiFailure("Příliš mnoho požadavků na KvizHub (429). Zkuste to znovu za minutu.", 429, last.body)
    if last.status >= 500:
        msg = (last.body or {}).get("error") if isinstance(last.body, dict) else None
        raise ApiFailure(f"KvizHub vrátil chybu serveru {last.status}{f': {msg}' if msg else ''}. Zkuste to znovu za chvíli.", last.status, last.body)
    raise ApiFailure(f"{last} Zkontrolujte, že aplikace běží a KVIZHUB_URL je správně. Zkusím to znovu za minutu.")


def idempotency_key(quiz: dict, params: str) -> str:
    material = {
        "files": sorted(str(f.get("sha256") or f.get("name")) for f in quiz.get("sourceFiles", []) if isinstance(f, dict)),
        "title": quiz.get("title"),
        "gradeLevel": quiz.get("gradeLevel"),
        "language": quiz.get("language", "cs"),
        "questionCount": len(quiz.get("questions", [])),
        "params": params,
    }
    return hashlib.sha256(json.dumps(material, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def error_message(status: int, body: object) -> str:
    msg = body.get("error") if isinstance(body, dict) else None
    return f"KvizHub vrátil {status}: {msg or 'neznámá chyba'}"


def post_quiz(path: Path, dry_run: bool, params: str, new_key: bool) -> tuple[int, object]:
    try:
        quiz = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise ApiFailure(f"Soubor {path} nelze načíst jako JSON ({e}).") from e
    blocked = [
        i + 1
        for i, q in enumerate(quiz.get("questions", []))
        if isinstance(q, dict) and BLOCKING_NOTE in str((q.get("qa") or {}).get("notes", "")).lower()
    ]
    if blocked:
        return 2, {
            "refused": True,
            "message": f"Otázky {', '.join(map(str, blocked))} mají citaci, která nebyla nalezena ve zdroji. Opravte citaci nebo otázku zahoďte a spusťte validate_quiz.py znovu.",
            "questions": blocked,
        }
    key = idempotency_key(quiz, params)
    if new_key:
        key = hashlib.sha256(f"{key}:{time.time_ns()}".encode()).hexdigest()
    status, _h, body = request("POST", "/quizzes?dry_run=1" if dry_run else "/quizzes", quiz, {} if dry_run else {"Idempotency-Key": key})
    if status == 422:
        return 2, {"errors": (body or {}).get("errors", [])}
    if status == 409:
        raise ApiFailure(error_message(status, body) + " Pro nový kvíz ze stejných podkladů použijte --new-key.", status, body)
    if status not in (200, 201):
        raise ApiFailure(error_message(status, body), status, body)
    return 0, body


def create_game(quiz_id: str, mode: str, leaderboard: bool) -> tuple[int, object]:
    status, _h, body = request("POST", f"/quizzes/{quiz_id}/games", {"mode": mode, "settings": {"showLeaderboard": leaderboard}})
    if status == 422:
        return 2, {"errors": (body or {}).get("errors", [])}
    if status != 201:
        raise ApiFailure(error_message(status, body), status, body)
    return 0, {k: body[k] for k in ("gameId", "pin", "joinUrl", "hostUrl") if k in body} | {"questionCount": body.get("questionCount")}


def results(game_id: str) -> tuple[int, object]:
    status, _h, body = request("GET", f"/games/{game_id}/results")
    if status != 200:
        raise ApiFailure(error_message(status, body), status, body)
    per_q = body.get("perQuestion", [])
    hardest = sorted((q for q in per_q if q.get("answered", 0) or body.get("playerCount")), key=lambda q: q.get("successRate", 0))[:3]
    body["summary"] = {
        "playerCount": body.get("playerCount", 0),
        "hardest": [{"number": q.get("number"), "percent": round(q.get("successRate", 0) * 100), "prompt": q.get("prompt")} for q in hardest],
        "top5": [{"nickname": r["nickname"], "score": r["score"]} for r in body.get("ranking", [])[:5]],
    }
    return 0, body


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Odeslání kvízu do KvizHubu, spuštění hry a výsledky.")
    ap.add_argument("quiz", nargs="?", type=Path)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--params", default="", help="parametry zakázky (počet otázek, ročník…) do Idempotency-Key")
    ap.add_argument("--new-key", action="store_true", help="vynutit nový kvíz i ze stejných podkladů")
    ap.add_argument("--game", metavar="QUIZ_ID")
    ap.add_argument("--mode", default="live", choices=["live", "selfpaced"])
    ap.add_argument("--no-leaderboard", action="store_true")
    ap.add_argument("--results", metavar="GAME_ID")
    args = ap.parse_args(argv)

    token = os.environ.get("KVIZHUB_TOKEN", "")
    try:
        if args.game:
            code, out = create_game(args.game, args.mode, not args.no_leaderboard)
        elif args.results:
            code, out = results(args.results)
        elif args.quiz:
            code, out = post_quiz(args.quiz, args.dry_run, args.params, args.new_key)
        else:
            ap.print_usage(sys.stderr)
            print("Zadejte soubor s kvízem, --game <quizId> nebo --results <gameId>.", file=sys.stderr)
            return 1
    except ApiFailure as e:
        print(redact(str(e), token), file=sys.stderr)
        return 1
    print(redact(json.dumps(out, ensure_ascii=False, indent=2), token))
    return code


if __name__ == "__main__":
    sys.exit(main())
