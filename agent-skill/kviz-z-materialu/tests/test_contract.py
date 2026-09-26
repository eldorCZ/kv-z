"""The Python contract mirror must agree with the server fixtures (/fixtures/quizzes)."""
import json
from pathlib import Path

import pytest

from contract import validate_quiz

QUIZZES = Path(__file__).resolve().parents[3] / "fixtures" / "quizzes"
EXPECTED = json.loads((QUIZZES / "invalid" / "_expected.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("name", sorted(p.name for p in (QUIZZES / "valid").glob("*.json")))
def test_valid_fixtures(name):
    assert validate_quiz(json.loads((QUIZZES / "valid" / name).read_text(encoding="utf-8"))) == []


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_invalid_fixtures(name):
    errors = validate_quiz(json.loads((QUIZZES / "invalid" / f"{name}.json").read_text(encoding="utf-8")))
    assert errors, name
    for exp in EXPECTED[name]:
        assert any(e["path"] == exp["path"] and e["code"] == exp["code"] for e in errors), (name, exp, errors)
