import copy
import json
from pathlib import Path

import pytest

import validate_quiz
from contract import validate_quiz as contract_validate

FIX = Path(__file__).resolve().parents[1] / "fixtures"


@pytest.fixture()
def sections(tmp_path):
    import extract

    out = tmp_path / "sections.json"
    extract.main([str(FIX / "optika.docx"), "--out", str(out)])
    return out


def load_quiz():
    return json.loads((FIX / "quiz.json").read_text(encoding="utf-8"))


def run(tmp_path, sections, quiz, *extra):
    qp = tmp_path / "quiz.json"
    qp.write_text(json.dumps(quiz, ensure_ascii=False), encoding="utf-8")
    out = tmp_path / "quiz.checked.json"
    code = validate_quiz.main([str(sections), str(qp), "--out", str(out), *extra])
    checked = json.loads(out.read_text(encoding="utf-8")) if out.exists() else None
    return code, checked


def report(capsys):
    return json.loads(capsys.readouterr().out)


def test_valid_sample_passes_unchanged(tmp_path, sections, capsys):
    quiz = load_quiz()
    code, checked = run(tmp_path, sections, quiz)
    rep = report(capsys)
    assert code == 0
    assert checked == quiz
    assert rep["toFix"] == [] and rep["invalid"] == []
    assert rep["ok"] == 7 and rep["flagged"] == 1
    assert rep["uncoveredSections"] == []
    assert contract_validate(checked) == []  # output is valid according to the contract


def test_invented_quote_is_caught(tmp_path, sections, capsys):
    quiz = load_quiz()
    quiz["questions"][0]["sourceRef"]["quote"] = "Lom světla objevil Isaac Newton v roce 1666 při pokusu s hranolem."
    code, checked = run(tmp_path, sections, quiz)
    rep = report(capsys)
    q = checked["questions"][0]
    assert q["qa"]["status"] == "flagged"
    assert "citace nenalezena ve zdroji" in q["qa"]["notes"].lower()
    assert {"question": 1, "reason": "citation_not_found"}.items() <= rep["toFix"][0].items()


def test_quote_with_small_differences_is_accepted(tmp_path, sections, capsys):
    quiz = load_quiz()
    # different quotes/dashes/whitespace and one typo -> still found (normalisation + fuzzy >= 0.9)
    quiz["questions"][0]["sourceRef"]["quote"] = "Změnu  směru šíření světla na rozhraní dvou prostředí nazýváme  lom světla"
    quiz["questions"][2]["sourceRef"]["quote"] = "Při přechodu do opticky řidšího prostředí se světlo láme od kolmce."
    _, checked = run(tmp_path, sections, quiz)
    assert checked["questions"][0]["qa"]["status"] == "ok"
    assert checked["questions"][2]["qa"]["status"] == "ok"


def test_quote_found_in_table(tmp_path, sections, capsys):
    quiz = load_quiz()
    quiz["questions"][6]["sourceRef"] = {"file": "optika.docx", "locator": "kapitola: Přehled indexů lomu", "quote": "Diamant | 2,42"}
    _, checked = run(tmp_path, sections, quiz)
    assert checked["questions"][6]["qa"]["status"] == "ok"


def test_duplicate_question_is_caught(tmp_path, sections, capsys):
    quiz = load_quiz()
    dup = copy.deepcopy(quiz["questions"][0])
    dup["prompt"] = "Jak se nazývá změna směru světla na rozhraní dvou různých prostředí?"
    quiz["questions"].append(dup)
    _, checked = run(tmp_path, sections, quiz)
    rep = report(capsys)
    assert checked["questions"][0]["qa"]["status"] == "ok"
    assert checked["questions"][-1]["qa"]["status"] == "flagged"
    assert "duplicita s otázkou 1" in checked["questions"][-1]["qa"]["notes"].lower()
    assert any(t["reason"] == "duplicate" for t in rep["toFix"])


def test_too_long_for_kahoot_is_caught_not_truncated(tmp_path, sections, capsys):
    quiz = load_quiz()
    long_prompt = "Jak se nazývá změna směru šíření světla, ke které dochází na rozhraní dvou různých optických prostředí?"
    quiz["questions"][0]["prompt"] = long_prompt
    quiz["questions"][0]["options"][0] = "Odraz světla na hladkém zrcadle při dopadu paprsku pod úhlem"
    _, checked = run(tmp_path, sections, quiz)
    q = checked["questions"][0]
    assert q["prompt"] == long_prompt
    assert q["qa"]["status"] == "flagged"
    assert "příliš dlouhé pro export do kahootu" in q["qa"]["notes"].lower()
    # custom limits
    _, checked2 = run(tmp_path, sections, quiz, "--max-q", "120", "--max-a", "75")
    assert checked2["questions"][0]["qa"]["status"] == "ok"


def test_invalid_schema_is_flagged_not_dropped(tmp_path, sections, capsys):
    quiz = load_quiz()
    quiz["questions"][0]["correctIndices"] = [7]
    quiz["questions"][1]["timeLimitSec"] = 15
    code, checked = run(tmp_path, sections, quiz)
    rep = report(capsys)
    assert code == 0
    assert len(checked["questions"]) == 8
    assert [i["question"] for i in rep["invalid"]] == [1, 2]
    assert rep["invalid"][0]["errors"][0]["code"] == "out_of_range"
    assert checked["questions"][0]["qa"]["status"] == "flagged"
    assert "neplatná otázka" in checked["questions"][0]["qa"]["notes"].lower()


def test_uncovered_sections_and_distribution(tmp_path, sections, capsys):
    quiz = load_quiz()
    quiz["questions"] = [q for q in quiz["questions"] if q["sourceRef"]["locator"] != "kapitola: Čočky"]
    run(tmp_path, sections, quiz)
    rep = report(capsys)
    assert [s["title"] for s in rep["uncoveredSections"]] == ["Čočky"]
    assert sum(rep["difficulty"].values()) == len(quiz["questions"])


def test_missing_explanation_is_only_a_warning(tmp_path, sections, capsys):
    quiz = load_quiz()
    quiz["questions"][0]["explanation"] = ""
    _, checked = run(tmp_path, sections, quiz)
    rep = report(capsys)
    assert checked["questions"][0]["qa"]["status"] == "ok"
    assert any("chybí vysvětlení" in w for w in rep["warnings"])


def test_unusable_quiz_exit_code_2(tmp_path, sections, capsys):
    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    assert validate_quiz.main([str(sections), str(bad), "--out", str(tmp_path / "o.json")]) == 2
    bad.write_text('{"title": "x"}', encoding="utf-8")
    assert validate_quiz.main([str(sections), str(bad), "--out", str(tmp_path / "o.json")]) == 2
