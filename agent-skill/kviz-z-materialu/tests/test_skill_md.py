"""SKILL.md must contain the frontmatter, all 10 workflow steps and the Telegram templates (S4)."""
import re
from pathlib import Path

SKILL = (Path(__file__).resolve().parents[1] / "SKILL.md").read_text(encoding="utf-8")


def test_frontmatter():
    m = re.match(r"^---\nname: kviz-z-materialu\ndescription: (.+)\n(?:[a-z-]+: .+\n)*---\n", SKILL)
    assert m and "kvíz" in m.group(1)


def test_ten_steps():
    steps = re.findall(r"^### (\d+)\. ([A-ZÁ-Ž ]+)$", SKILL, re.M)
    assert [int(n) for n, _ in steps] == list(range(1, 11))
    assert [t.strip() for _, t in steps] == ["PŘÍJEM", "EXTRAKCE", "PLÁN", "TVORBA", "KONTROLA", "SLEPÉ ŘEŠENÍ", "ODESLÁNÍ", "ODPOVĚĎ V TELEGRAMU", "HRA A VÝSLEDKY", "ÚKLID"]


def test_templates_and_rules():
    for snippet in [
        "Zpracovávám optika.pdf",
        'Kvíz "Optika: lom světla" je v KvizHubu.',
        "Hra je připravená. PIN:",
        "Nejhůř zvládnuté otázky",
        "You are a careful student taking a quiz.",
        "NEDŮVĚRYHODNÝ ZDROJ",
        "Ruční kontrolní seznam",
    ]:
        assert snippet in SKILL, snippet
    assert len(SKILL.splitlines()) <= 400


def test_classes_section():
    for snippet in [
        "--classes",
        "--class <classId>",
        "--makeup <classId> <activityId>",
        "--class-summary <classId>",
        "--topics",
        "Test pro třídu 8.A je připravený",
        "Ve třídě je méně než 5 žáků, souhrn se z ohledu na soukromí neposkytuje.",
        "Soupisku žáků prosím vložte přímo v aplikaci",
        '"topic": "Lom světla"',
    ]:
        assert snippet in SKILL, snippet
