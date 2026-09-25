#!/usr/bin/env python3
"""Quality checks for a quiz written by the agent (no language model involved).

Usage: python validate_quiz.py sections.json quiz.json --out quiz.checked.json [--max-q 95 --max-a 60]

Steps (in this order):
 1) schema and sanity check (same rules as the server, see contract.py)
 2) citation check: sourceRef.quote must be found in the section text (normalised) or fuzzy match >= 0.9
 3) de-duplication: Jaccard similarity of words > 0.7 -> the later question is flagged
 4) Kahoot length limits (--max-q / --max-a) -> flagged, never truncated
 5) missing explanation -> warning only

Writes quiz.checked.json with qa.status / qa.notes filled in and prints a JSON report to stdout.
Exit code 0 = processed, 2 = quiz.json unusable (not JSON / no questions list).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from contract import validate_question  # noqa: E402

try:
    from rapidfuzz import fuzz
except ImportError:  # pragma: no cover – listed in requirements.txt
    fuzz = None

FUZZY_THRESHOLD = 90
DUPLICATE_JACCARD = 0.7

NOTE_CITATION = "citace nenalezena ve zdroji"
NOTE_NO_SOURCE = "chybí citace zdroje (sourceRef.quote)"
NOTE_TOO_LONG = "příliš dlouhé pro export do Kahootu"

QUOTES = str.maketrans({"„": '"', "“": '"', "”": '"', "‚": "'", "‘": "'", "’": "'", "»": '"', "«": '"', "–": "-", "—": "-", "−": "-", "\u00ad": None, "\u00a0": " "})


def normalize(s: str) -> str:
    s = unicodedata.normalize("NFC", s).translate(QUOTES)
    s = re.sub(r"(\w)-\s*\n\s*(?=\w)", r"\1", s)  # words split at line ends
    return re.sub(r"\s+", " ", s).strip().lower()


def words(s: str) -> set[str]:
    return set(re.findall(r"\w+", normalize(s)))


def quote_found(quote: str, text: str) -> bool:
    q, t = normalize(quote), normalize(text)
    if not q:
        return False
    if q in t:
        return True
    if fuzz is None or len(q) < 12:
        return False
    return fuzz.partial_ratio(q, t, score_cutoff=FUZZY_THRESHOLD) >= FUZZY_THRESHOLD


def jaccard(a: set[str], b: set[str]) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def add_note(q: dict, note: str) -> None:
    qa = q.get("qa") if isinstance(q.get("qa"), dict) else {}
    notes = str(qa.get("notes", "")).strip()
    if note not in notes:
        notes = f"{notes.rstrip('.')}; {note}" if notes else note
    notes = notes[0].upper() + notes[1:] if notes else notes
    if not notes.endswith("."):
        notes += "."
    q["qa"] = {"status": "flagged", "notes": notes[:500]}


def section_texts(sections_doc: dict) -> tuple[dict[str, list[dict]], list[dict]]:
    by_file: dict[str, list[dict]] = {}
    all_sections = []
    for f in sections_doc.get("files", []):
        for s in f.get("sections", []):
            s = {**s, "file": f.get("name", "")}
            by_file.setdefault(f.get("name", ""), []).append(s)
            all_sections.append(s)
    return by_file, all_sections


def full_text(s: dict) -> str:
    return "\n".join([s.get("text", ""), *s.get("tables", [])])


def check(sections_doc: dict, quiz: dict, max_q: int = 95, max_a: int = 60) -> dict:
    by_file, all_sections = section_texts(sections_doc)
    questions = quiz["questions"]
    report = {
        "total": len(questions),
        "ok": 0,
        "flagged": 0,
        "invalid": [],
        "toFix": [],
        "uncoveredSections": [],
        "difficulty": {},
        "bloom": {},
        "types": {},
        "warnings": [],
    }
    covered: set[str] = set()
    seen_words: list[tuple[int, set[str]]] = []

    for i, q in enumerate(questions):
        num = i + 1
        if not isinstance(q, dict):
            report["invalid"].append({"question": num, "errors": [{"path": "", "code": "invalid_type", "message": "Otázka musí být objekt."}]})
            continue
        # 1) schema
        errors = validate_question(q)
        if errors:
            report["invalid"].append({"question": num, "errors": errors})
            add_note(q, f"neplatná otázka: {errors[0]['path']} – {errors[0]['message'].rstrip('.')}")
            report["toFix"].append({"question": num, "reason": "schema", "detail": errors[0]["message"]})

        # 2) citation
        sr = q.get("sourceRef") if isinstance(q.get("sourceRef"), dict) else None
        quote = str(sr.get("quote", "")) if sr else ""
        if not quote.strip():
            add_note(q, NOTE_NO_SOURCE)
            report["toFix"].append({"question": num, "reason": "no_quote"})
        else:
            file = str(sr.get("file", ""))
            candidates = by_file.get(file) or all_sections
            locator = str(sr.get("locator", ""))
            # sections with the matching locator first
            candidates = sorted(candidates, key=lambda s: 0 if locator and s.get("locator") == locator else 1)
            hit = next((s for s in candidates if quote_found(quote, full_text(s))), None)
            if hit is None:
                add_note(q, NOTE_CITATION)
                report["toFix"].append({"question": num, "reason": "citation_not_found", "quote": quote[:120]})
            else:
                covered.add(hit["id"])
                if file not in by_file:
                    report["warnings"].append(f"Otázka {num}: sourceRef.file „{file}“ neodpovídá žádnému souboru, citace nalezena v {hit['file']}.")

        # 3) duplicates
        w = words(str(q.get("prompt", "")))
        for j, other in seen_words:
            if jaccard(w, other) > DUPLICATE_JACCARD:
                add_note(q, f"duplicita s otázkou {j}")
                report["toFix"].append({"question": num, "reason": "duplicate", "of": j})
                break
        seen_words.append((num, w))

        # 4) Kahoot length limits
        prompt = str(q.get("prompt", ""))
        long_options = [o for o in q.get("options", []) or [] if isinstance(o, str) and len(o) > max_a]
        if len(prompt) > max_q or long_options:
            detail = []
            if len(prompt) > max_q:
                detail.append(f"otázka {len(prompt)}/{max_q} znaků")
            if long_options:
                detail.append(f"{len(long_options)} možnost(i) nad {max_a} znaků")
            add_note(q, f"{NOTE_TOO_LONG} ({', '.join(detail)})")
            report["toFix"].append({"question": num, "reason": "too_long", "detail": ", ".join(detail)})

        # 5) explanation
        if not str(q.get("explanation", "") or "").strip():
            report["warnings"].append(f"Otázka {num}: chybí vysvětlení.")

    for q in questions:
        if not isinstance(q, dict):
            continue
        status = (q.get("qa") or {}).get("status", "ok")
        report["flagged" if status == "flagged" else "ok"] += 1
        report["difficulty"] = dict(Counter(report["difficulty"]) + Counter({str(q.get("difficulty") or "neuvedeno"): 1}))
        report["bloom"] = dict(Counter(report["bloom"]) + Counter({str(q.get("bloom") or "neuvedeno"): 1}))
        report["types"] = dict(Counter(report["types"]) + Counter({str(q.get("type")): 1}))
    report["uncoveredSections"] = [
        {"id": s["id"], "title": s.get("title", ""), "locator": s.get("locator", ""), "charCount": s.get("charCount", 0)}
        for s in all_sections
        if s["id"] not in covered and s.get("charCount", 0) >= 200
    ]
    return report


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Kontrola kvality kvízu (schéma, citace, duplicity, délky).")
    ap.add_argument("sections", type=Path)
    ap.add_argument("quiz", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--max-q", type=int, default=95)
    ap.add_argument("--max-a", type=int, default=60)
    args = ap.parse_args(argv)

    try:
        sections_doc = json.loads(args.sections.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(json.dumps({"error": f"sections.json nelze načíst: {e}"}, ensure_ascii=False))
        return 2
    try:
        quiz = json.loads(args.quiz.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        print(json.dumps({"error": f"quiz.json není platný JSON: {e}"}, ensure_ascii=False))
        return 2
    if not isinstance(quiz, dict) or not isinstance(quiz.get("questions"), list) or not quiz["questions"]:
        print(json.dumps({"error": "quiz.json musí být objekt s neprázdným polem questions."}, ensure_ascii=False))
        return 2

    report = check(sections_doc, quiz, args.max_q, args.max_a)
    args.out.write_text(json.dumps(quiz, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
