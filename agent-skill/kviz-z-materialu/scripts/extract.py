#!/usr/bin/env python3
"""Extract text from DOCX, PDF, PPTX, TXT and MD files into sections.

Usage: python extract.py <file> [<file> ...] --out sections.json

Output: {"files": [{"name", "sha256", "kind", "sections": [Section]}], "warnings": [...]}
Section: {"id", "title", "locator", "text", "tables", "hasImages", "charCount"}

Document content is treated as data only: macros and embedded objects are ignored and nothing is executed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path

MAX_FILE_BYTES = 25 * 1024 * 1024
# zip bomb protection for OOXML (docx/pptx)
MAX_UNZIPPED_BYTES = 200 * 1024 * 1024
MAX_ZIP_ENTRIES = 5000
MAX_COMPRESSION_RATIO = 200
TEXT_BLOCK_CHARS = 3000
PPTX_MERGE_BELOW = 200
SPARSE_PAGE_CHARS = 200
SHORT_DOCUMENT_CHARS = 500

SOFT_HYPHEN = "\u00ad"


class ExtractError(Exception):
    """A problem with one file; reported as a warning, extraction continues with the other files."""


# ---------------------------------------------------------------- helpers

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def clean_text(text: str) -> str:
    """Remove soft hyphens, join words split at line ends, collapse blank lines and spaces."""
    text = text.replace(SOFT_HYPHEN, "").replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\u00a0", " ")
    # "rozdě-\nlené" -> "rozdělené" (only lowercase letters on both sides)
    text = re.sub(r"(\w)-\n(?=[a-zà-ž])", r"\1", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def check_zip(path: Path) -> None:
    """Reject OOXML archives that look like zip bombs."""
    try:
        with zipfile.ZipFile(path) as z:
            infos = z.infolist()
    except zipfile.BadZipFile as e:
        raise ExtractError(f"{path.name}: soubor je poškozený nebo chráněný heslem ({e}).") from e
    if len(infos) > MAX_ZIP_ENTRIES:
        raise ExtractError(f"{path.name}: archiv má příliš mnoho položek ({len(infos)}), soubor odmítnut.")
    total = sum(i.file_size for i in infos)
    if total > MAX_UNZIPPED_BYTES:
        raise ExtractError(f"{path.name}: rozbalená velikost {total // (1024 * 1024)} MB je příliš velká (podezření na zip bombu), soubor odmítnut.")
    for i in infos:
        if i.compress_size > 0 and i.file_size / i.compress_size > MAX_COMPRESSION_RATIO and i.file_size > 1024 * 1024:
            raise ExtractError(f"{path.name}: podezřelý kompresní poměr u {i.filename} (zip bomba), soubor odmítnut.")


def make_section(title: str, locator: str, text: str, tables: list[str] | None = None, has_images: bool = False) -> dict:
    text = clean_text(text)
    tables = [clean_text(t) for t in (tables or []) if t.strip()]
    return {
        "id": "",
        "title": title.strip()[:200],
        "locator": locator[:60],
        "text": text,
        "tables": tables,
        "hasImages": has_images,
        "charCount": len(text) + sum(len(t) for t in tables),
    }


def detect_kind(path: Path) -> str:
    ext = path.suffix.lower()
    with path.open("rb") as f:
        head = f.read(8)
    if ext == ".pdf" or head.startswith(b"%PDF"):
        return "pdf"
    if ext in (".docx", ".docm"):
        return "docx"
    if ext in (".pptx", ".pptm"):
        return "pptx"
    if ext in (".txt", ".md", ".markdown", ".text"):
        return "text"
    if head.startswith(b"PK"):
        # guess OOXML type from the archive content
        try:
            with zipfile.ZipFile(path) as z:
                names = z.namelist()
        except zipfile.BadZipFile:
            names = []
        if any(n.startswith("word/") for n in names):
            return "docx"
        if any(n.startswith("ppt/") for n in names):
            return "pptx"
    raise ExtractError(f"{path.name}: nepodporovaný formát (podporované: DOCX, PDF, PPTX, TXT, MD).")


# ---------------------------------------------------------------- DOCX

HEADING_RE = re.compile(r"^((heading|nadpis|überschrift|titre)\s*[1-3]|title|název)$", re.I)


def extract_docx(path: Path, warnings: list[str]) -> list[dict]:
    check_zip(path)
    from docx import Document  # noqa: PLC0415
    from docx.table import Table  # noqa: PLC0415
    from docx.text.paragraph import Paragraph  # noqa: PLC0415

    try:
        doc = Document(str(path))
    except Exception as e:  # noqa: BLE001
        raise ExtractError(f"{path.name}: dokument nelze otevřít ({e.__class__.__name__}); je poškozený nebo chráněný heslem.") from e

    sections: list[dict] = []
    cur = {"title": "", "paras": [], "tables": [], "images": False}
    heading_count = 0

    def flush():
        if cur["paras"] or cur["tables"]:
            title = cur["title"] or (path.stem if not sections else "Úvod")
            locator = f"kapitola: {cur['title']}" if cur["title"] else "úvod dokumentu"
            sections.append(make_section(title, locator, "\n".join(cur["paras"]), cur["tables"], cur["images"]))

    body = doc.element.body
    for child in body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            p = Paragraph(child, doc)
            style = (p.style.name if p.style is not None else "") or ""
            text = p.text.strip()
            if child.xpath(".//*[local-name()='drawing' or local-name()='pict']"):
                cur["images"] = True
            m = HEADING_RE.match(style.strip())
            if m and text:
                heading_count += 1
                flush()
                cur = {"title": text, "paras": [], "tables": [], "images": False}
            elif text:
                cur["paras"].append(text)
        elif tag == "tbl":
            t = Table(child, doc)
            rows = []
            for row in t.rows:
                cells = []
                for c in row.cells:
                    v = " ".join(c.text.split())
                    if not cells or cells[-1] != v:  # merged cells repeat their value
                        cells.append(v)
                rows.append(" | ".join(cells))
            cur["tables"].append("\n".join(rows))
    flush()

    if heading_count == 0 and len(sections) == 1:
        sections[0]["title"] = path.stem
        sections[0]["locator"] = "celý dokument"
    if any(s["hasImages"] for s in sections):
        warnings.append(f"{path.name}: dokument obsahuje obrázky nebo grafy, jejich obsah není v extrahovaném textu.")
    return sections


# ---------------------------------------------------------------- PPTX

def extract_pptx(path: Path, warnings: list[str]) -> list[dict]:
    check_zip(path)
    from pptx import Presentation  # noqa: PLC0415
    from pptx.enum.shapes import MSO_SHAPE_TYPE  # noqa: PLC0415

    try:
        prs = Presentation(str(path))
    except Exception as e:  # noqa: BLE001
        raise ExtractError(f"{path.name}: prezentaci nelze otevřít ({e.__class__.__name__}); je poškozená nebo chráněná heslem.") from e

    def shape_texts(shapes, title_shape, out: list[str], tables: list[str]) -> bool:
        images = False
        for sh in shapes:
            if sh.shape_type == MSO_SHAPE_TYPE.GROUP:
                images |= shape_texts(sh.shapes, title_shape, out, tables)
                continue
            if sh.shape_type in (MSO_SHAPE_TYPE.PICTURE, MSO_SHAPE_TYPE.CHART) or getattr(sh, "has_chart", False):
                images = True
            if title_shape is not None and sh.shape_id == title_shape.shape_id:
                continue
            if getattr(sh, "has_table", False) and sh.has_table:
                rows = [" | ".join(" ".join(c.text.split()) for c in r.cells) for r in sh.table.rows]
                tables.append("\n".join(rows))
            elif getattr(sh, "has_text_frame", False) and sh.has_text_frame:
                t = sh.text_frame.text.strip()
                if t:
                    out.append(t)
        return images

    slides = []
    for n, slide in enumerate(prs.slides, start=1):
        title_shape = slide.shapes.title
        title = title_shape.text.strip() if title_shape is not None and title_shape.has_text_frame else ""
        body: list[str] = []
        tables: list[str] = []
        images = shape_texts(slide.shapes, title_shape, body, tables)
        notes = ""
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame is not None:
            notes = slide.notes_slide.notes_text_frame.text.strip()
        text = "\n".join(body)
        if notes:
            text = f"{text}\n\nPoznámky řečníka:\n{notes}" if text else f"Poznámky řečníka:\n{notes}"
        slides.append({"n": n, "title": title, "text": text, "tables": tables, "images": images})

    # merge consecutive short slides (< 200 characters)
    sections: list[dict] = []
    group: list[dict] = []

    def flush_group():
        if not group:
            return
        first, last = group[0]["n"], group[-1]["n"]
        locator = f"slide {first}" if first == last else f"slidy {first}-{last}"
        title = " / ".join(s["title"] for s in group if s["title"]) or f"Slide {first}"
        text = "\n\n".join((f"{s['title']}\n{s['text']}" if s["title"] and len(group) > 1 else s["text"]) for s in group)
        sections.append(make_section(title, locator, text, [t for s in group for t in s["tables"]], any(s["images"] for s in group)))
        group.clear()

    for s in slides:
        size = len(s["text"]) + sum(len(t) for t in s["tables"])
        if size < PPTX_MERGE_BELOW:
            group.append(s)
            if sum(len(x["text"]) for x in group) >= PPTX_MERGE_BELOW:
                flush_group()
        else:
            flush_group()
            group.append(s)
            flush_group()
    flush_group()
    sections = [s for s in sections if s["charCount"] > 0 or s["title"]]
    if any(s["hasImages"] for s in sections):
        warnings.append(f"{path.name}: některé slidy obsahují obrázky nebo grafy, jejich obsah není v extrahovaném textu.")
    return sections


# ---------------------------------------------------------------- PDF

PAGE_NUMBER_RE = re.compile(r"^\s*(-\s*)?(strana|str\.|page|s\.)?\s*\d{1,4}\s*(/\s*\d{1,4})?(\s*-)?\s*$", re.I)


def _norm_line(line: str) -> str:
    return re.sub(r"\d+", "#", " ".join(line.split()).lower())


def remove_headers_footers(pages: list[str]) -> list[str]:
    """Drop lines that repeat at the top/bottom of many pages (digits ignored) and bare page numbers."""
    if len(pages) < 3:
        return ["\n".join(line for line in p.split("\n") if not PAGE_NUMBER_RE.match(line)) for p in pages]
    edge = Counter()
    for p in pages:
        lines = [line for line in p.split("\n") if line.strip()]
        for line in set(lines[:2] + lines[-2:]):
            edge[_norm_line(line)] += 1
    repeated = {k for k, v in edge.items() if v >= max(3, len(pages) * 0.5)}
    out = []
    for p in pages:
        lines = p.split("\n")
        keep = []
        for i, line in enumerate(lines):
            at_edge = i < 2 or i >= len(lines) - 2
            if PAGE_NUMBER_RE.match(line) or (at_edge and _norm_line(line) in repeated):
                continue
            keep.append(line)
        out.append("\n".join(keep))
    return out


def _pdf_outline_starts(pdf) -> list[tuple[int, str]]:
    """Top level bookmarks as (page_index, title); empty when unavailable."""
    try:
        from pdfminer.pdftypes import resolve1  # noqa: PLC0415
        from pdfminer.psparser import PSLiteral  # noqa: PLC0415

        doc = pdf.doc
        page_ids = {p.page_obj.pageid: i for i, p in enumerate(pdf.pages)}
        starts = []
        for level, title, dest, action, _se in doc.get_outlines():
            if level != 1:
                continue
            target = dest
            if target is None and action is not None:
                act = resolve1(action)
                if isinstance(act, dict):
                    target = act.get("D")
            target = resolve1(target)
            if isinstance(target, (bytes, str, PSLiteral)):
                named = doc.get_dest(target.name if isinstance(target, PSLiteral) else target)
                target = resolve1(named)
                if isinstance(target, dict):
                    target = resolve1(target.get("D"))
            if isinstance(target, list) and target:
                ref = target[0]
                objid = getattr(ref, "objid", None)
                if objid in page_ids:
                    starts.append((page_ids[objid], str(title).strip()))
        starts.sort()
        return starts
    except Exception:  # noqa: BLE001 – outlines are optional
        return []


def extract_pdf(path: Path, warnings: list[str]) -> list[dict]:
    import pdfplumber  # noqa: PLC0415

    try:
        pdf = pdfplumber.open(str(path))
    except Exception as e:  # noqa: BLE001
        name = e.__class__.__name__
        if "Password" in name or "Encrypt" in str(e):
            raise ExtractError(f"{path.name}: PDF je chráněné heslem, nelze ho zpracovat.") from e
        raise ExtractError(f"{path.name}: PDF nelze otevřít ({name}).") from e

    with pdf:
        raw_pages: list[str] = []
        images: list[bool] = []
        for i, page in enumerate(pdf.pages, start=1):
            try:
                raw_pages.append(page.extract_text(x_tolerance=1.5, y_tolerance=3) or "")
                images.append(bool(page.images) or bool(page.curves and len(page.curves) > 20))
            except Exception as e:  # noqa: BLE001
                warnings.append(f"{path.name}: stranu {i} se nepodařilo zpracovat ({e.__class__.__name__}).")
                raw_pages.append("")
                images.append(False)
        starts = _pdf_outline_starts(pdf)

    pages = remove_headers_footers(raw_pages)
    sparse = [i + 1 for i, p in enumerate(pages) if len(p.strip()) < SPARSE_PAGE_CHARS]
    if sparse:
        if len(sparse) == len(pages):
            warnings.append(f"{path.name}: v PDF je velmi málo textu ({len(pages)} str.), pravděpodobně jde o sken. Prohlédněte stránky jako obrázky.")
        else:
            warnings.append(f"{path.name}: málo textu na stranách {', '.join(map(str, sparse))} (pravděpodobně sken nebo obrázky).")
    with_images = [i + 1 for i, has in enumerate(images) if has]
    if with_images:
        warnings.append(f"{path.name}: obrázky nebo grafy na stranách {', '.join(map(str, with_images))}, jejich obsah není v textu.")

    def page_locator(a: int, b: int) -> str:
        return f"str. {a + 1}" if a == b else f"str. {a + 1}-{b + 1}"

    ranges: list[tuple[int, int, str]] = []
    if starts and starts[0][0] <= len(pages) - 1:
        if starts[0][0] > 0:
            ranges.append((0, starts[0][0] - 1, "Úvod"))
        for idx, (start, title) in enumerate(starts):
            end = starts[idx + 1][0] - 1 if idx + 1 < len(starts) else len(pages) - 1
            if end >= start:
                ranges.append((start, end, title))
    else:
        avg = sum(len(p) for p in pages) / max(1, len(pages))
        size = 3 if avg < 2000 else 2
        for a in range(0, len(pages), size):
            b = min(a + size, len(pages)) - 1
            ranges.append((a, b, ""))

    sections = []
    for a, b, title in ranges:
        text = "\n\n".join(pages[a : b + 1])
        first_line = next((line.strip() for line in text.split("\n") if line.strip()), "")
        sections.append(make_section(title or first_line[:80] or page_locator(a, b), page_locator(a, b), text, [], any(images[a : b + 1])))
    return sections


# ---------------------------------------------------------------- TXT / MD

MD_HEADING_RE = re.compile(r"^(#{1,3})\s+(.+?)\s*#*\s*$")


def extract_text(path: Path, warnings: list[str]) -> list[dict]:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "cp1250", "latin-1"):
        try:
            content = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    lines = content.replace("\r\n", "\n").split("\n")
    has_headings = any(MD_HEADING_RE.match(line) for line in lines)
    sections: list[dict] = []
    if has_headings:
        title, buf = "", []

        def flush():
            text = "\n".join(buf).strip()
            if text:
                sections.append(make_section(title or "Úvod", f"kapitola: {title}" if title else "úvod dokumentu", text))

        for line in lines:
            m = MD_HEADING_RE.match(line)
            if m:
                flush()
                title, buf = m.group(2), []
            else:
                buf.append(line)
        flush()
    else:
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", content) if p.strip()]
        block, first = [], 1
        for i, p in enumerate(paragraphs, start=1):
            if block and sum(len(x) for x in block) + len(p) > TEXT_BLOCK_CHARS:
                sections.append(make_section(block[0].split("\n")[0][:80], f"odstavce {first}-{i - 1}" if i - 1 > first else f"odstavec {first}", "\n\n".join(block)))
                block, first = [], i
            block.append(p)
        if block:
            last = len(paragraphs)
            sections.append(make_section(block[0].split("\n")[0][:80], f"odstavce {first}-{last}" if last > first else f"odstavec {first}", "\n\n".join(block)))
    return sections


# ---------------------------------------------------------------- main

EXTRACTORS = {"docx": extract_docx, "pptx": extract_pptx, "pdf": extract_pdf, "text": extract_text}


def extract_files(paths: list[Path]) -> dict:
    files, warnings = [], []
    counter = 0
    for path in paths:
        try:
            if not path.is_file():
                raise ExtractError(f"{path.name}: soubor neexistuje.")
            size = path.stat().st_size
            if size > MAX_FILE_BYTES:
                raise ExtractError(f"{path.name}: soubor má {size // (1024 * 1024)} MB, limit je 25 MB.")
            if size == 0:
                raise ExtractError(f"{path.name}: soubor je prázdný.")
            kind = detect_kind(path)
            sections = EXTRACTORS[kind](path, warnings)
        except ExtractError as e:
            warnings.append(str(e))
            continue
        for s in sections:
            counter += 1
            s["id"] = f"s{counter}"
        total = sum(s["charCount"] for s in sections)
        if total < SHORT_DOCUMENT_CHARS:
            warnings.append(f"{path.name}: podezřele krátký dokument ({total} znaků textu).")
        files.append({"name": path.name, "sha256": sha256_file(path), "kind": kind, "sections": sections})
    return {"files": files, "warnings": warnings}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Extrakce textu z DOCX/PDF/PPTX/TXT/MD do sekcí.")
    ap.add_argument("files", nargs="+", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args(argv)
    result = extract_files(args.files)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    summary = {
        "files": [{"name": f["name"], "kind": f["kind"], "sections": len(f["sections"]), "chars": sum(s["charCount"] for s in f["sections"])} for f in result["files"]],
        "warnings": result["warnings"],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if result["files"] else 1


if __name__ == "__main__":
    sys.exit(main())
