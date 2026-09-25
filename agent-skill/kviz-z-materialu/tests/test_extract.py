import json
import zipfile

import pytest
from docgen import make_docx, make_pdf, make_pptx

import extract


def run(tmp_path, *files):
    out = tmp_path / "sections.json"
    code = extract.main([*map(str, files), "--out", str(out)])
    return code, json.loads(out.read_text(encoding="utf-8"))


def test_docx_headings_and_table(tmp_path):
    code, res = run(tmp_path, make_docx(tmp_path / "bio.docx"))
    assert code == 0
    f = res["files"][0]
    assert f["kind"] == "docx" and len(f["sha256"]) == 64
    secs = f["sections"]
    assert [s["title"] for s in secs] == ["Fotosyntéza", "Dýchání"]
    assert [s["locator"] for s in secs] == ["kapitola: Fotosyntéza", "kapitola: Dýchání"]
    assert "chloroplastech" in secs[0]["text"]
    assert secs[1]["tables"] == ["Proces | Produkt\nFotosyntéza | Glukóza"]
    assert [s["id"] for s in secs] == ["s1", "s2"]
    for s in secs:
        assert set(s) == {"id", "title", "locator", "text", "tables", "hasImages", "charCount"}
        assert s["charCount"] == len(s["text"]) + sum(len(t) for t in s["tables"])


def test_pptx_notes_and_merging(tmp_path):
    code, res = run(tmp_path, make_pptx(tmp_path / "bunka.pptx"))
    assert code == 0
    secs = res["files"][0]["sections"]
    # slides 1 and 2 are short (< 200 chars) and get merged, slide 3 is on its own
    assert [s["locator"] for s in secs] == ["slidy 1-2", "slide 3"]
    assert "Poznámka k úvodu." in secs[0]["text"]
    assert "jádro obsahuje DNA" in secs[1]["text"]
    assert "Doplňkový text." in secs[1]["text"]
    assert secs[1]["title"] == "Buňka"


def test_pdf_pages_headers_footers(tmp_path):
    body = [
        ["Skola Zelena - Prirodopis", "Kapitola o bunkach a jejich stavbe.", "Bunka ma jadro a cytoplazmu.", "Strana 1"],
        ["Skola Zelena - Prirodopis", "Mitochondrie vyrabeji energii pro bunku.", "Ribozomy tvori bilkoviny.", "Strana 2"],
        ["Skola Zelena - Prirodopis", "Rostlinna bunka ma bunecnou stenu.", "Chloroplasty obsahuji chlorofyl.", "Strana 3"],
        ["Skola Zelena - Prirodopis", "Zivocisna bunka nema bunecnou stenu.", "Vakuoly jsou mensi.", "Strana 4"],
    ]
    code, res = run(tmp_path, make_pdf(tmp_path / "bunka.pdf", body))
    assert code == 0
    f = res["files"][0]
    assert f["kind"] == "pdf"
    locs = [s["locator"] for s in f["sections"]]
    assert locs == ["str. 1-3", "str. 4"]
    text = "\n".join(s["text"] for s in f["sections"])
    assert "Mitochondrie" in text and "Vakuoly" in text
    assert "Skola Zelena" not in text  # repeated header removed
    assert "Strana" not in text  # page numbers removed
    assert any("málo textu" in w for w in res["warnings"])  # tiny pages look like scans


def test_markdown_and_short_document_warning(tmp_path):
    md = tmp_path / "poznamky.md"
    md.write_text("# Úvod\nText úvodu.\n\n## Detail\nPodrobný popis s roz-\ndělenými slovy a\u00admekkym delenim.\n", encoding="utf-8")
    code, res = run(tmp_path, md)
    secs = res["files"][0]["sections"]
    assert [s["locator"] for s in secs] == ["kapitola: Úvod", "kapitola: Detail"]
    assert "rozdělenými" in secs[1]["text"]
    assert "a\u00admekkym" not in secs[1]["text"] and "amekkym" in secs[1]["text"]
    assert any("krátký dokument" in w for w in res["warnings"])


def test_plain_text_blocks(tmp_path):
    txt = tmp_path / "dlouhy.txt"
    txt.write_text("\n\n".join(f"Odstavec {i}. " + "slovo " * 150 for i in range(1, 9)), encoding="utf-8")
    _, res = run(tmp_path, txt)
    secs = res["files"][0]["sections"]
    assert len(secs) >= 3
    assert all(len(s["text"]) <= 3000 + 1000 for s in secs)
    assert secs[0]["locator"].startswith("odstav")


def test_zip_bomb_rejected(tmp_path):
    bomb = tmp_path / "bomba.docx"
    with zipfile.ZipFile(bomb, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("word/document.xml", b"\0" * (20 * 1024 * 1024))
    code, res = run(tmp_path, bomb)
    assert code == 1
    assert res["files"] == []
    assert any("zip bomb" in w for w in res["warnings"])


def test_oversize_unsupported_and_multiple_files(tmp_path):
    big = tmp_path / "velky.pdf"
    with big.open("wb") as f:
        f.truncate(26 * 1024 * 1024)
    exe = tmp_path / "program.exe"
    exe.write_bytes(b"MZ\x90\x00")
    docx = make_docx(tmp_path / "a.docx")
    md = tmp_path / "b.md"
    md.write_text("# Kapitola\n" + "Obsah kapitoly. " * 50, encoding="utf-8")
    code, res = run(tmp_path, big, exe, docx, md)
    assert code == 0
    assert [f["name"] for f in res["files"]] == ["a.docx", "b.md"]
    ids = [s["id"] for f in res["files"] for s in f["sections"]]
    assert ids == [f"s{i}" for i in range(1, len(ids) + 1)]  # unique across files
    assert any("limit je 25 MB" in w for w in res["warnings"])
    assert any("nepodporovaný formát" in w for w in res["warnings"])


def test_corrupted_docx(tmp_path):
    bad = tmp_path / "rozbity.docx"
    bad.write_bytes(b"PK\x03\x04 not really a zip")
    code, res = run(tmp_path, bad)
    assert code == 1
    assert "poškozený" in res["warnings"][0]


@pytest.mark.parametrize("text,expected", [("slo-\nvo", "slovo"), ("a\u00adb", "ab"), ("a\n\n\n\nb", "a\n\nb"), ("  x  ", "x")])
def test_clean_text(text, expected):
    assert extract.clean_text(text) == expected
