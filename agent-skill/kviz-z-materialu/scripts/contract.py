"""Python mirror of the Lore contract rules (section 2.3). The server (zod, packages/core) stays the source of truth;
tests in tests/test_contract.py check that both accept and reject the same fixtures."""
from __future__ import annotations

import re

QUESTION_TYPES = ("single", "multi", "truefalse", "short", "numeric", "order")
TIME_LIMITS = (5, 10, 20, 30, 60, 120)
POINTS = ("standard", "double", "none")
BLOOM = ("remember", "understand", "apply", "analyze")
DIFFICULTY = ("easy", "medium", "hard")
TRUEFALSE = ["Pravda", "Nepravda"]
LIMITS = {"title": 120, "prompt": 300, "option": 120, "explanation": 300, "quote": 300, "locator": 60, "accepted": 60, "questions": 100}


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def validate_question(q, prefix: str = "") -> list[dict]:
    """Returns a list of {path, code, message} (empty = valid). Mirrors questionSchema from packages/core."""
    errs: list[dict] = []

    def err(path: str, code: str, message: str):
        errs.append({"path": f"{prefix}{path}", "code": code, "message": message})

    if not isinstance(q, dict):
        err("", "invalid_type", "Otázka musí být objekt.")
        return errs

    def text(key: str, maximum: int, required: bool = True) -> str:
        v = q.get(key)
        if v is None:
            if required:
                err(key, "required", "Povinné pole chybí.")
            return ""
        if not isinstance(v, str):
            err(key, "invalid_type", "Očekáván typ text.")
            return ""
        v = v.strip()
        if required and not v:
            err(key, "empty", "Text nesmí být prázdný.")
        if len(v) > maximum:
            err(key, "too_long", f"Text je příliš dlouhý (max. {maximum} znaků, má {len(v)}).")
        return v

    qtype = q.get("type")
    if qtype not in QUESTION_TYPES:
        err("type", "invalid_value" if qtype is not None else "required", f"Neplatný typ. Povolené: {', '.join(QUESTION_TYPES)}.")
    text("prompt", LIMITS["prompt"])
    explanation = q.get("explanation", "")
    if explanation is not None and (not isinstance(explanation, str) or len(explanation.strip()) > LIMITS["explanation"]):
        err("explanation", "too_long", f"Vysvětlení může mít nejvýše {LIMITS['explanation']} znaků.")

    def str_list(key: str, maximum: int) -> list[str]:
        v = q.get(key, [])
        if v is None:
            v = []
        if not isinstance(v, list):
            err(key, "invalid_type", "Očekáváno pole.")
            return []
        out = []
        for i, item in enumerate(v):
            if not isinstance(item, str) or not item.strip():
                err(f"{key}[{i}]", "empty", "Text nesmí být prázdný.")
                out.append("")
                continue
            if len(item.strip()) > maximum:
                err(f"{key}[{i}]", "too_long", f"Text je příliš dlouhý (max. {maximum} znaků, má {len(item.strip())}).")
            out.append(item.strip())
        if len(v) > 5:
            err(key, "too_many", "Příliš mnoho položek (max. 5).")
        return out

    options = str_list("options", LIMITS["option"])
    accepted = str_list("acceptedAnswers", LIMITS["accepted"])
    ci = q.get("correctIndices", [])
    if ci is None or not isinstance(ci, list) or not all(_is_int(x) for x in ci):
        err("correctIndices", "invalid_type", "correctIndices musí být pole celých čísel.")
        ci = []
    na, nt = q.get("numericAnswer"), q.get("numericTolerance")
    if na is not None and not _is_num(na):
        err("numericAnswer", "invalid_type", "Očekáváno číslo.")
    if nt is not None and (not _is_num(nt) or nt < 0):
        err("numericTolerance", "too_small", "Tolerance musí být číslo >= 0.")

    t = q.get("timeLimitSec", 20)
    if t not in TIME_LIMITS or isinstance(t, bool):
        err("timeLimitSec", "invalid_time_limit", f"Časový limit musí být jedna z hodnot {', '.join(map(str, TIME_LIMITS))} s.")
    if q.get("points", "standard") not in POINTS:
        err("points", "invalid_value", f"Povolené hodnoty: {', '.join(POINTS)}.")
    if q.get("bloom") not in (None, *BLOOM):
        err("bloom", "invalid_value", f"Povolené hodnoty: {', '.join(BLOOM)}.")
    if q.get("difficulty") not in (None, *DIFFICULTY):
        err("difficulty", "invalid_value", f"Povolené hodnoty: {', '.join(DIFFICULTY)}.")

    sr = q.get("sourceRef")
    if sr is not None:
        if not isinstance(sr, dict):
            err("sourceRef", "invalid_type", "sourceRef musí být objekt.")
        else:
            if not isinstance(sr.get("file"), str) or not sr["file"].strip():
                err("sourceRef.file", "required", "Povinné pole chybí.")
            if len(str(sr.get("locator", ""))) > LIMITS["locator"]:
                err("sourceRef.locator", "too_long", f"Text je příliš dlouhý (max. {LIMITS['locator']} znaků).")
            if len(str(sr.get("quote", "")).strip()) > LIMITS["quote"]:
                err("sourceRef.quote", "too_long", f"Text je příliš dlouhý (max. {LIMITS['quote']} znaků, má {len(str(sr.get('quote', '')).strip())}).")

    qa = q.get("qa", {"status": "ok", "notes": ""}) or {}
    if not isinstance(qa, dict) or qa.get("status", "ok") not in ("ok", "flagged"):
        err("qa.status", "invalid_value", "qa.status musí být ok nebo flagged.")
    elif qa.get("status") == "flagged" and not str(qa.get("notes", "")).strip():
        err("qa.notes", "notes_required", "Otázka ve stavu „flagged“ musí mít vyplněnou poznámku (qa.notes).")

    n = len(options)

    def count(lo: int, hi: int) -> bool:
        if n < lo or n > hi:
            err("options", "option_count", f"Typ „{qtype}“ vyžaduje {lo if lo == hi else f'{lo}–{hi}'} možnosti, zadáno {n}.")
            return False
        return True

    def check_indices():
        seen = set()
        for i, idx in enumerate(ci):
            if idx < 0 or idx >= n:
                err(f"correctIndices[{i}]", "out_of_range", f"Index {idx} je mimo rozsah možností.")
            if idx in seen:
                err(f"correctIndices[{i}]", "duplicate_index", f"Index {idx} je uveden vícekrát.")
            seen.add(idx)

    def none_of(*keys: str):
        for k in keys:
            if k == "options" and n:
                err("options", "options_not_allowed", f"Typ „{qtype}“ nesmí mít možnosti.")
            if k == "correctIndices" and ci:
                err("correctIndices", "correct_not_allowed", f"Typ „{qtype}“ nepoužívá correctIndices.")
            if k == "acceptedAnswers" and accepted:
                err("acceptedAnswers", "accepted_not_allowed", f"Typ „{qtype}“ nesmí mít acceptedAnswers.")
            if k == "numeric" and (na is not None or nt is not None):
                err("numericAnswer", "numeric_not_allowed", f"Typ „{qtype}“ nesmí mít numericAnswer ani numericTolerance.")

    if qtype == "single":
        if count(3, 4):
            check_indices()
        if len(ci) != 1:
            err("correctIndices", "correct_count", "Typ „single“ musí mít právě 1 správnou odpověď.")
        none_of("acceptedAnswers", "numeric")
    elif qtype == "multi":
        if count(4, 5):
            check_indices()
        if len(ci) < 2:
            err("correctIndices", "correct_count", "Typ „multi“ musí mít alespoň 2 správné odpovědi.")
        elif n and len(ci) >= n:
            err("correctIndices", "correct_count", "Typ „multi“ nesmí mít správné všechny možnosti.")
        none_of("acceptedAnswers", "numeric")
    elif qtype == "truefalse":
        if n and options != TRUEFALSE:
            err("options", "truefalse_options", 'Typ „truefalse“ musí mít možnosti přesně ["Pravda","Nepravda"] (nebo je vynechte).')
        if ci not in ([0], [1]):
            err("correctIndices", "correct_count", "Typ „truefalse“ musí mít correctIndices [0] (Pravda) nebo [1] (Nepravda).")
        none_of("acceptedAnswers", "numeric")
    elif qtype == "short":
        none_of("options", "correctIndices", "numeric")
        if not accepted:
            err("acceptedAnswers", "accepted_count", "Typ „short“ vyžaduje 1–5 přijatelných odpovědí (acceptedAnswers).")
    elif qtype == "numeric":
        none_of("options", "correctIndices", "acceptedAnswers")
        if na is None:
            err("numericAnswer", "required", "Typ „numeric“ vyžaduje číselnou odpověď (numericAnswer).")
        if nt is None:
            err("numericTolerance", "required", "Typ „numeric“ vyžaduje toleranci (numericTolerance >= 0).")
    elif qtype == "order":
        count(3, 5)
        none_of("correctIndices", "acceptedAnswers", "numeric")

    for key, values in (("options", options), ("acceptedAnswers", accepted)):
        seen: dict[str, int] = {}
        for i, v in enumerate(values):
            k = norm(v)
            if not k:
                continue
            if k in seen:
                err(f"{key}[{i}]", "duplicate", f"„{v}“ je duplicitní s položkou {seen[k]}.")
            else:
                seen[k] = i
    return errs


def validate_quiz(quiz) -> list[dict]:
    errs: list[dict] = []
    if not isinstance(quiz, dict):
        return [{"path": "", "code": "invalid_type", "message": "Kvíz musí být objekt JSON."}]
    if quiz.get("schemaVersion") != 1:
        errs.append({"path": "schemaVersion", "code": "invalid_value", "message": "schemaVersion musí být 1."})
    title = quiz.get("title")
    if not isinstance(title, str) or not title.strip():
        errs.append({"path": "title", "code": "required" if title is None else "empty", "message": "Název kvízu chybí."})
    elif len(title.strip()) > LIMITS["title"]:
        errs.append({"path": "title", "code": "too_long", "message": f"Název je příliš dlouhý (max. {LIMITS['title']} znaků)."})
    qs = quiz.get("questions")
    if not isinstance(qs, list):
        errs.append({"path": "questions", "code": "required", "message": "Chybí pole questions."})
        return errs
    if not qs:
        errs.append({"path": "questions", "code": "too_few", "message": "Kvíz musí mít alespoň 1 otázku."})
    if len(qs) > LIMITS["questions"]:
        errs.append({"path": "questions", "code": "too_many", "message": f"Kvíz může mít nejvýše {LIMITS['questions']} otázek."})
    for i, q in enumerate(qs):
        errs.extend(validate_question(q, f"questions[{i}]."))
    for e in errs:
        e["path"] = e["path"].rstrip(".")
    return errs[:50]
