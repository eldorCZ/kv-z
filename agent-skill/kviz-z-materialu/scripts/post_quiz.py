#!/usr/bin/env python3
"""Send a checked quiz to Lore, create games and read results.

Usage:
  python post_quiz.py quiz.checked.json [--dry-run] [--params "15 otázek, 8. ročník"] [--new-key]
  python post_quiz.py --game <quizId> [--mode live] [--no-leaderboard]
  python post_quiz.py --game <quizId> --mode test [--time-limit 20] [--closes-at 2026-10-01T18:00:00+02:00] [--show-results none|score|full]
      [--leave-guard off|log|warn] [--max-leaves 2] [--on-exceed notify|lock] [--fullscreen]
  python post_quiz.py --results <gameId>
  python post_quiz.py --classes                                   (class names and counts only)
  python post_quiz.py --game <quizId> [--mode test ...] --class <classId> [--label "Písemka 2"] [--allow-guests] [--no-stats]
  python post_quiz.py --makeup <classId> <activityId>             (makeup test for absent students)
  python post_quiz.py --class-summary <classId> [--from 2026-09-01] [--to 2027-01-31]   (aggregates only)
  python post_quiz.py --topics                                    (topics used so far)
  python post_quiz.py --themes                                    (built-in background motives)
  --motive <id> / --accent <id> with a quiz file or --game: look of the quiz or of one game.
      ONLY when the teacher asked for a look; otherwise the teacher's default applies.

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
from urllib.parse import quote, urlencode

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
        raise ApiFailure("Chybí proměnná prostředí KVIZHUB_URL (adresa aplikace Lore, např. http://127.0.0.1:3000).")
    if not token:
        raise ApiFailure("Chybí proměnná prostředí KVIZHUB_TOKEN (API token vytvořený v aplikaci Lore v Nastavení → API tokeny).")
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
            last = ApiFailure(redact(f"Aplikace Lore neodpovídá ({reason}).", token))
            continue
    assert last is not None
    if last.status == 429:
        raise ApiFailure("Příliš mnoho požadavků na aplikaci Lore (429). Zkuste to znovu za minutu.", 429, last.body)
    if last.status >= 500:
        msg = (last.body or {}).get("error") if isinstance(last.body, dict) else None
        raise ApiFailure(f"Aplikace Lore vrátila chybu serveru {last.status}{f': {msg}' if msg else ''}. Zkuste to znovu za chvíli.", last.status, last.body)
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
    return f"Aplikace Lore vrátila {status}: {msg or 'neznámá chyba'}"


def theme_of(motive: str | None, accent: str | None) -> dict | None:
    theme = {k: v for k, v in (("motive", motive), ("accent", accent)) if v}
    return theme or None


def post_quiz(path: Path, dry_run: bool, params: str, new_key: bool, theme: dict | None = None) -> tuple[int, object]:
    try:
        quiz = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise ApiFailure(f"Soubor {path} nelze načíst jako JSON ({e}).") from e
    if theme:
        # the look only on the teacher's explicit wish (Dodatek 4, V7.4); unknown ids come back as warnings
        quiz["theme"] = theme
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


def create_game(quiz_id: str, mode: str, leaderboard: bool, test: dict | None = None, klass: dict | None = None, theme: dict | None = None) -> tuple[int, object]:
    settings: dict = {"showLeaderboard": leaderboard}
    if mode == "test":
        settings = {"test": {k: v for k, v in (test or {}).items() if v is not None}}
    if theme:
        settings["theme"] = theme
    if klass:
        # class game (Dodatek 3): students log in with their personal code; audience is always the whole class
        settings |= {k: v for k, v in klass.items() if v is not None}
    status, _h, body = request("POST", f"/quizzes/{quiz_id}/games", {"mode": mode, "settings": settings})
    if status == 422:
        return 2, {"errors": (body or {}).get("errors", [])}
    if status != 201:
        raise ApiFailure(error_message(status, body), status, body)
    keys = ("gameId", "mode", "pin", "joinUrl", "qrUrl", "dashboardUrl", "hostUrl", "closesAt") if mode == "test" else ("gameId", "pin", "joinUrl", "hostUrl")
    out = {k: body[k] for k in keys if k in body} | {"questionCount": body.get("questionCount")}
    if body.get("warnings"):
        out["warnings"] = body["warnings"]
    if klass:
        out["classId"] = klass.get("classId")
    return 0, out


# ---------------------------------------------------------------- classes (Dodatek 3): aggregates only

CLASS_KEYS = ("id", "name", "schoolYear", "subject", "status", "activeStudents")
ACTIVITY_KEYS = ("activityId", "label", "kind", "playedAt", "n", "participationRate", "avgPercent", "medianPercent", "note")


def list_classes() -> tuple[int, object]:
    status, _h, body = request("GET", "/classes")
    if status != 200:
        raise ApiFailure(error_message(status, body), status, body)
    # whitelist: the agent never handles anything but class names and counts
    return 0, {"classes": [{k: c.get(k) for k in CLASS_KEYS} for c in (body or {}).get("classes", [])]}


def makeup(class_id: str, activity_id: str) -> tuple[int, object]:
    status, _h, body = request("POST", f"/classes/{quote(class_id)}/activities/{quote(activity_id)}/makeup", {})
    if status not in (200, 201):
        raise ApiFailure(error_message(status, body), status, body)
    keys = ("gameId", "pin", "joinUrl", "hostUrl", "resultsUrl", "audienceSize", "reused")
    return 0, {k: body[k] for k in keys if k in body}


def class_summary(class_id: str, date_from: str | None, date_to: str | None) -> tuple[int, object]:
    query = urlencode({k: v for k, v in (("from", date_from), ("to", date_to)) if v})
    status, _h, body = request("GET", f"/classes/{quote(class_id)}/summary" + (f"?{query}" if query else ""))
    if status != 200:
        raise ApiFailure(error_message(status, body), status, body)
    b = body or {}
    return 0, {
        "className": b.get("className"),
        "period": b.get("period"),
        "activeStudents": b.get("activeStudents"),
        "testAvg": b.get("testAvg"),
        "quizAvg": b.get("quizAvg"),
        "participationRate": b.get("participationRate"),
        "activities": [{k: a.get(k) for k in ACTIVITY_KEYS if k in a} for a in b.get("activities", [])],
        "weakTopics": [{k: t.get(k) for k in ("topic", "successRate", "items")} for t in b.get("weakTopics", [])],
        "weakQuestions": [{k: q.get(k) for k in ("quizId", "questionId", "prompt", "successRate", "answers")} for q in b.get("weakQuestions", [])],
        "notes": b.get("notes", []),
    }


def themes() -> tuple[int, object]:
    status, _h, body = request("GET", "/themes")
    if status != 200:
        raise ApiFailure(error_message(status, body), status, body)
    return 0, {"themes": body or []}


def topics() -> tuple[int, object]:
    status, _h, body = request("GET", "/topics")
    if status != 200:
        raise ApiFailure(error_message(status, body), status, body)
    return 0, {"topics": (body or {}).get("topics", [])}


def results(game_id: str) -> tuple[int, object]:
    status, _h, body = request("GET", f"/games/{game_id}/results")
    if status != 200:
        raise ApiFailure(error_message(status, body), status, body)
    per_q = body.get("perQuestion", [])
    if body.get("mode") == "test":
        # the agent only ever gets aggregates for tests: no names, no per-student data (D10, G7)
        summ = body.get("summary", {})
        hardest = sorted(per_q, key=lambda q: q.get("successRate", 0))[:3] if summ.get("submitted") else []
        out = {
            "mode": "test",
            "status": body.get("status"),
            "summary": {
                "students": summ.get("students", 0),
                "submitted": summ.get("submitted", 0),
                "avgPercent": summ.get("avgPercent"),
                "medianPercent": summ.get("medianPercent"),
                "hardest": [{"number": q.get("number"), "percent": round(q.get("successRate", 0) * 100), "prompt": q.get("prompt")} for q in hardest],
                "leaveFlagged": summ.get("leaveFlagged"),
            },
        }
        return 0, out
    hardest = sorted((q for q in per_q if q.get("answered", 0) or body.get("playerCount")), key=lambda q: q.get("successRate", 0))[:3]
    body["summary"] = {
        "playerCount": body.get("playerCount", 0),
        "hardest": [{"number": q.get("number"), "percent": round(q.get("successRate", 0) * 100), "prompt": q.get("prompt")} for q in hardest],
        "top5": [{"nickname": r["nickname"], "score": r["score"]} for r in body.get("ranking", [])[:5]],
    }
    return 0, body


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Odeslání kvízu do aplikace Lore, spuštění hry a výsledky.")
    ap.add_argument("quiz", nargs="?", type=Path)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--params", default="", help="parametry zakázky (počet otázek, ročník…) do Idempotency-Key")
    ap.add_argument("--new-key", action="store_true", help="vynutit nový kvíz i ze stejných podkladů")
    ap.add_argument("--game", metavar="QUIZ_ID")
    ap.add_argument("--mode", default="live", choices=["live", "test", "selfpaced"])
    ap.add_argument("--no-leaderboard", action="store_true")
    ap.add_argument("--time-limit", type=int, help="test: minut na pokus (1-240)")
    ap.add_argument("--closes-at", help="test: termín uzavření (ISO 8601 s časovou zónou)")
    ap.add_argument("--show-results", choices=["none", "score", "full"], help="test: co žák uvidí po odevzdání")
    ap.add_argument("--leave-guard", choices=["off", "log", "warn"], help="test: hlídání opuštění okna")
    ap.add_argument("--max-leaves", type=int, help="test: tolerovaná opuštění okna (0-10)")
    ap.add_argument("--on-exceed", choices=["notify", "lock"], help="test: reakce po překročení")
    ap.add_argument("--fullscreen", action="store_true", help="test: vyžadovat celou obrazovku")
    ap.add_argument("--results", metavar="GAME_ID")
    ap.add_argument("--classes", action="store_true", help="seznam tříd (jen názvy a počty)")
    ap.add_argument("--class", dest="class_id", metavar="CLASS_ID", help="s --game: třídní hra (žáci se přihlásí osobním kódem)")
    ap.add_argument("--label", help="s --class: název záznamu v evidenci třídy (max 60 znaků)")
    ap.add_argument("--allow-guests", action="store_true", help="s --class: povolit hosty bez kódu")
    ap.add_argument("--no-stats", action="store_true", help="s --class: nezapočítat do evidence (zkušební hra)")
    ap.add_argument("--makeup", nargs=2, metavar=("CLASS_ID", "ACTIVITY_ID"), help="náhradní termín testu pro nepřítomné")
    ap.add_argument("--class-summary", metavar="CLASS_ID", help="souhrn třídy (jen agregace)")
    ap.add_argument("--from", dest="date_from", help="s --class-summary: od data (ISO)")
    ap.add_argument("--to", dest="date_to", help="s --class-summary: do data (ISO)")
    ap.add_argument("--topics", action="store_true", help="dosud použitá témata otázek")
    ap.add_argument("--themes", action="store_true", help="vestavěné motivy pozadí")
    ap.add_argument("--motive", help="s kvízem nebo --game: motiv pozadí (jen na přání učitele)")
    ap.add_argument("--accent", help="s kvízem nebo --game: barva akcentu (jen na přání učitele)")
    args = ap.parse_args(argv)
    if (args.motive or args.accent) and not (args.game or args.quiz):
        ap.error("--motive a --accent patří ke kvízu nebo k --game")
    if (args.label or args.allow_guests or args.no_stats) and not args.class_id:
        ap.error("--label, --allow-guests a --no-stats patří k --class")
    if args.class_id and not args.game:
        ap.error("--class se používá s --game <quizId>")

    token = os.environ.get("KVIZHUB_TOKEN", "")
    try:
        if args.game:
            mode = "test" if args.mode == "selfpaced" else args.mode
            test = {"timeLimitMin": args.time_limit, "closesAt": args.closes_at, "showResultsToStudent": args.show_results}
            guard = {"mode": args.leave_guard, "maxLeaves": args.max_leaves, "onExceed": args.on_exceed, "requireFullscreen": True if args.fullscreen else None}
            guard = {k: v for k, v in guard.items() if v is not None}
            if guard:
                test["leaveGuard"] = guard
            klass = None
            if args.class_id:
                klass = {"classId": args.class_id, "label": args.label, "allowGuests": True if args.allow_guests else None, "countInStats": False if args.no_stats else None}
            code, out = create_game(args.game, mode, not args.no_leaderboard, test, klass, theme_of(args.motive, args.accent))
        elif args.classes:
            code, out = list_classes()
        elif args.makeup:
            code, out = makeup(*args.makeup)
        elif args.class_summary:
            code, out = class_summary(args.class_summary, args.date_from, args.date_to)
        elif args.topics:
            code, out = topics()
        elif args.themes:
            code, out = themes()
        elif args.results:
            code, out = results(args.results)
        elif args.quiz:
            code, out = post_quiz(args.quiz, args.dry_run, args.params, args.new_key, theme_of(args.motive, args.accent))
        else:
            ap.print_usage(sys.stderr)
            print("Zadejte soubor s kvízem, --game <quizId>, --results <gameId>, --classes, --class-summary <classId>, --makeup <classId> <activityId> --topics nebo --themes.", file=sys.stderr)
            return 1
    except ApiFailure as e:
        print(redact(str(e), token), file=sys.stderr)
        return 1
    print(redact(json.dumps(out, ensure_ascii=False, indent=2), token))
    return code


if __name__ == "__main__":
    sys.exit(main())
