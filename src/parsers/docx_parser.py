"""
DOCX Bilingual Table Parser — Phrase / CAT tool export format.

Parses bilingual Word (.docx) tables exported from Phrase and similar
CAT tools, and supports writing edited translations back to the docx file.

Phrase en-no-T structure (separate tables in document):
  Table 0: instruction row (1 column, ignored)
  Table 1: metadata row (7 columns: lang codes, job info — ignored)
  Table 2: header row (7 columns: ID, ICU, #, Source (en), Target (no), <match%>, Comment)
  Table 3: data rows (7 columns per segment):
            0=key, 1=ICU flag, 2=seq#, 3=source, 4=target, 5=match%, 6=comment

Write-back strategy:
  - The parsed XML tree is kept in memory (attached to DocxDocument).
  - Each DocxSegment holds a direct lxml element reference to its target <w:tc>.
  - On save, we rebuild the target cell's paragraph runs to reflect the edited text,
    splitting around placeholders ({1}, {2}, …) and preserving the paragraph style
    and run formatting from the original cell.
  - The modified XML tree is serialised back into the docx zip, creating a
    timestamped backup of the original first.
"""

import io
import re
import shutil
import zipfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from lxml import etree


# ── XML namespaces ────────────────────────────────────────────────────────────

W   = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W14 = "http://schemas.microsoft.com/office/word/2010/wordml"

def _w(local: str) -> str:
    return f"{{{W}}}{local}"


# ── Placeholder pattern (Phrase style: {1}, {2}, …) ─────────────────────────

_PLACEHOLDER_RE = re.compile(r"(\{[^}]+\}|\[\d+\]|<[^>]+>|&[a-z]+;|\[[A-Z_]+\])")


# ── Data classes ──────────────────────────────────────────────────────────────

@dataclass
class DocxSegment:
    """A bilingual segment extracted from a docx table, with write-back support."""
    id: str
    source_plain: str
    target_plain: str
    source_raw: str
    target_raw: str
    file_name: str
    match_percent: Optional[int] = None
    is_locked: bool = False
    # lxml element reference for write-back — the <w:tc> that holds the target text
    target_element: object = field(default=None, repr=False)
    # Not used for docx (no XLIFF parent concept), kept for API compatibility
    parent_element: object = field(default=None, repr=False)


@dataclass
class DocxDocument:
    """
    A loaded docx document with its parsed XML tree and segment list.
    Keeps the in-memory tree so edits can be applied and saved.
    """
    path: str
    root: object            # lxml root element of word/document.xml
    zip_names: List[str]    # all file names in the zip
    zip_contents: Dict[str, bytes]  # all file bytes keyed by name
    doc_xml_name: str       # e.g. "word/document.xml"
    segments: List[DocxSegment]
    target_language: str = ""


# ── Cell text extraction ──────────────────────────────────────────────────────

def _get_cell_text(cell_elem) -> str:
    """Concatenate all <w:t> text runs in a cell."""
    return "".join(t.text or "" for t in cell_elem.iter(_w("t"))).strip()


def _get_table_rows_as_text(table) -> List[List[str]]:
    return [
        [_get_cell_text(c) for c in row.findall(_w("tc"))]
        for row in table.findall(_w("tr"))
        if row.findall(_w("tc"))
    ]


# ── Column layout detection ───────────────────────────────────────────────────

def _detect_layout_from_header(header_cells: List[str]) -> dict:
    layout = {
        "key": None, "icu": None, "seq": None,
        "source": None, "target": None,
        "match": None, "comment": None,
    }
    for i, raw in enumerate(header_cells):
        t = raw.strip().lower()
        if t in ("id", "key", "segment key", "segment id"):
            layout["key"] = i
        elif t in ("icu", "icu#", "icu flag"):
            layout["icu"] = i
        elif t in ("#", "seq", "no.", "nr", "no") or t.isdigit():
            layout["seq"] = i
        elif t.startswith("source") or re.match(r"^[a-z]{2}(-[a-z]{2,4})?$", t):
            if layout["source"] is None:
                layout["source"] = i
        elif t.startswith("target"):
            if layout["target"] is None:
                layout["target"] = i
        elif t in ("match", "tm", "tm%", "%", "score", "cu") or t.endswith("%"):
            layout["match"] = i
        elif t.startswith("comment"):
            layout["comment"] = i

    # Infer match column when unlabelled (Phrase leaves it blank)
    if layout["match"] is None and layout["target"] is not None:
        tgt = layout["target"]
        cmt = layout.get("comment")
        n   = len(header_cells)
        if cmt is not None and cmt > tgt + 1:
            layout["match"] = tgt + 1
        elif cmt is None and tgt + 1 < n:
            layout["match"] = tgt + 1

    # Fallback positional assignment
    if layout["source"] is None and layout["target"] is None:
        n = len(header_cells)
        if n >= 7:
            layout.update({"key": 0, "seq": 2, "source": 3, "target": 4, "match": 5})
        elif n == 5:
            layout.update({"key": 0, "seq": 2, "source": 3, "target": 4})
        elif n == 4:
            layout.update({"seq": 0, "source": 1, "target": 2, "match": 3})
        elif n >= 2:
            layout.update({"source": 0, "target": 1})

    return layout


def _heuristic_layout(n_cols: int) -> dict:
    if n_cols >= 7:
        return {"key": 0, "icu": 1, "seq": 2, "source": 3,
                "target": 4, "match": 5, "comment": 6}
    if n_cols == 5:
        return {"key": 0, "icu": None, "seq": 2, "source": 3,
                "target": 4, "match": None, "comment": None}
    if n_cols == 4:
        return {"key": 0, "icu": None, "seq": 1, "source": 2,
                "target": 3, "match": None, "comment": None}
    if n_cols == 3:
        return {"key": None, "icu": None, "seq": None, "source": 0,
                "target": 1, "match": 2, "comment": None}
    return {"key": None, "icu": None, "seq": None, "source": 0,
            "target": 1, "match": None, "comment": None}


def _parse_match_percent(text: str) -> Optional[int]:
    text = text.replace("%", "").strip()
    try:
        val = int(float(text))
        if 0 <= val <= 102:
            return val
    except (ValueError, TypeError):
        pass
    return None


def _cell(row: List[str], idx) -> str:
    if idx is None or idx >= len(row):
        return ""
    return row[idx]


# ── Run formatting helpers ────────────────────────────────────────────────────

def _get_run_lang(run_elem) -> str:
    """Return the w:lang w:val of a run's <w:rPr>, or ''."""
    rpr = run_elem.find(_w("rPr"))
    if rpr is None:
        return ""
    lang = rpr.find(_w("lang"))
    if lang is None:
        return ""
    return lang.get(_w("val"), "")


def _detect_target_lang(cell_elem) -> str:
    """
    Detect the target language from the first run in a target cell that
    has a non-English lang attribute (e.g. 'nb-NO', 'de-DE').
    Falls back to '' if not found.
    """
    for run in cell_elem.iter(_w("r")):
        lang = _get_run_lang(run)
        if lang and not lang.lower().startswith("en"):
            return lang
    return ""


def _make_rpr(lang: str, is_placeholder: bool = False) -> etree._Element:
    """
    Build a minimal <w:rPr> element.
    Placeholders use English; normal text uses target language.
    """
    rpr = etree.Element(_w("rPr"))
    noproof = etree.SubElement(rpr, _w("noProof"))
    noproof.set(_w("val"), "false")
    lang_elem = etree.SubElement(rpr, _w("lang"))
    if is_placeholder:
        lang_elem.set(_w("val"), "en-us")
    else:
        lang_elem.set(_w("val"), lang or "nb-NO")
    return rpr


def _make_run(text: str, lang: str, is_placeholder: bool = False) -> etree._Element:
    """Build a single <w:r> with formatting and text."""
    run = etree.Element(_w("r"))
    run.append(_make_rpr(lang, is_placeholder))
    t = etree.SubElement(run, _w("t"))
    t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    t.text = text
    return run


def _build_runs(text: str, lang: str) -> List[etree._Element]:
    """
    Split *text* around placeholders ({1}, {2}, …) and produce a list of
    <w:r> elements — placeholder runs get lang="en-us", the rest get *lang*.
    """
    parts = _PLACEHOLDER_RE.split(text)
    runs = []
    for part in parts:
        if not part:
            continue
        is_ph = bool(_PLACEHOLDER_RE.fullmatch(part))
        runs.append(_make_run(part, lang, is_placeholder=is_ph))
    return runs


# ── Target cell write-back ────────────────────────────────────────────────────

def _update_target_cell(cell_elem, new_text: str, lang: str) -> None:
    """
    Replace the text content of a target <w:tc> element in-place.

    Strategy:
    1. Find the first (usually only) <w:p> in the cell.
    2. Keep <w:tcPr> and <w:pPr> unchanged (preserves column width, style, etc.).
    3. Remove all existing <w:r> and <w:proofErr> child nodes from <w:p>.
    4. Insert fresh <w:proofErr type="spellStart"/>, new <w:r> runs, then
       <w:proofErr type="spellEnd"/>.
    """
    para = cell_elem.find(_w("p"))
    if para is None:
        return

    # Remove runs and proofErr marks — keep pPr and bookmarks intact
    to_remove = [
        child for child in para
        if child.tag in (_w("r"), _w("proofErr"), _w("ins"), _w("del"))
    ]
    for child in to_remove:
        para.remove(child)

    # Build new runs
    new_runs = _build_runs(new_text, lang)
    if not new_runs:
        return

    # Insert: proofErr spellStart → runs → proofErr spellEnd
    spell_start = etree.Element(_w("proofErr"))
    spell_start.set(_w("type"), "spellStart")
    spell_end = etree.Element(_w("proofErr"))
    spell_end.set(_w("type"), "spellEnd")

    para.append(spell_start)
    for run in new_runs:
        para.append(run)
    para.append(spell_end)


# ── Main parse function ───────────────────────────────────────────────────────

def parse_phrase_docx(path: str) -> List[DocxSegment]:
    """
    Convenience wrapper — parse only, return segments.
    Use load_phrase_docx() when you need write-back capability.
    """
    doc = load_phrase_docx(path)
    return doc.segments


def load_phrase_docx(path: str) -> DocxDocument:
    """
    Parse a bilingual docx table (Phrase / CAT tool export).

    Returns a DocxDocument whose segments have live lxml element references
    so that edits can be applied and saved back to the file.
    """
    path_obj = Path(path)
    if not path_obj.exists():
        raise FileNotFoundError(f"File not found: {path}")

    # Read entire zip into memory so we can repack it later
    zip_contents: Dict[str, bytes] = {}
    zip_names: List[str] = []
    with zipfile.ZipFile(str(path_obj), "r") as zf:
        for name in zf.namelist():
            zip_names.append(name)
            zip_contents[name] = zf.read(name)

    doc_xml_name = next(
        (n for n in zip_names if n.lower().endswith("word/document.xml")), None
    )
    if doc_xml_name is None:
        raise ValueError("Not a valid docx file: missing word/document.xml")

    root = etree.fromstring(zip_contents[doc_xml_name])

    file_name = path_obj.name
    tables = list(root.iter(_w("tbl")))
    if not tables:
        raise ValueError("No tables found in this docx file.")

    table_rows: List[List[List[str]]] = [
        _get_table_rows_as_text(t) for t in tables
    ]

    # ── Locate header table ───────────────────────────────────────────────────
    HEADER_KEYWORDS = {"id", "source", "target", "#", "seq", "icu", "comment",
                       "key", "match", "tm"}

    layout = None
    data_table_idx = None

    for ti, rows in enumerate(table_rows):
        if not rows:
            continue
        candidate = rows[0]
        lower_set = {c.strip().lower() for c in candidate}
        if lower_set & HEADER_KEYWORDS and len(candidate) >= 2:
            layout = _detect_layout_from_header(candidate)
            for j in range(ti + 1, len(table_rows)):
                if len(table_rows[j]) > 1:
                    data_table_idx = j
                    break
            if data_table_idx is not None:
                break

    # ── Fallback: embedded grey header row ───────────────────────────────────
    if layout is None:
        for ti, table_elem in enumerate(tables):
            rows_elem = list(table_elem.findall(_w("tr")))
            if len(rows_elem) < 2:
                continue
            for row_elem in rows_elem:
                cells = list(row_elem.findall(_w("tc")))
                if not cells:
                    continue
                shd = None
                for c in cells:
                    shd = c.find(f".//{_w('shd')}")
                    if shd is not None:
                        break
                if shd is not None:
                    fill = shd.get(_w("fill"), "")
                    if fill.upper() in ("D9D9D9", "BFBFBF", "C0C0C0", "808080"):
                        hcells = [_get_cell_text(c) for c in cells]
                        candidate_layout = _detect_layout_from_header(hcells)
                        if (candidate_layout["source"] is not None
                                and candidate_layout["target"] is not None):
                            layout = candidate_layout
                            data_table_idx = ti
                            break
            if layout is not None:
                break

    # ── Absolute fallback ─────────────────────────────────────────────────────
    if layout is None:
        best = max(
            ((ti, rows) for ti, rows in enumerate(table_rows)
             if rows and len(rows[0]) >= 2),
            key=lambda x: len(x[1]),
            default=None,
        )
        if best is None:
            raise ValueError("No bilingual table found in this docx file.")
        data_table_idx = best[0]
        layout = _heuristic_layout(len(table_rows[data_table_idx][0]))

    # ── Build segments with live element references ───────────────────────────
    data_table_elem = tables[data_table_idx]
    data_rows_elem  = list(data_table_elem.findall(_w("tr")))
    data_rows_text  = table_rows[data_table_idx]

    # Detect target language from the first non-empty target cell
    target_language = ""
    tgt_col = layout.get("target")

    segments: List[DocxSegment] = []
    seg_counter = 0

    for row_elem, row_cells in zip(data_rows_elem, data_rows_text):
        if not row_cells:
            continue
        # Skip rows where source+target are both empty
        src = _cell(row_cells, layout.get("source"))
        tgt = _cell(row_cells, layout.get("target"))
        if not src and not tgt:
            continue
        # Skip embedded header rows
        if src.strip().lower() in ("source", "source text", "source (en)", "src"):
            continue

        cells_elem = list(row_elem.findall(_w("tc")))

        # Get the actual lxml element for the target cell
        tgt_cell_elem = cells_elem[tgt_col] if tgt_col is not None and tgt_col < len(cells_elem) else None

        # Detect lang from first populated target cell
        if not target_language and tgt_cell_elem is not None:
            target_language = _detect_target_lang(tgt_cell_elem)

        seg_key = _cell(row_cells, layout.get("key"))
        seq_num = _cell(row_cells, layout.get("seq"))
        if seg_key:
            seg_id = seg_key
        elif seq_num:
            seg_id = seq_num
        else:
            seg_counter += 1
            seg_id = str(seg_counter)

        match_pct = _parse_match_percent(_cell(row_cells, layout.get("match")))

        segments.append(DocxSegment(
            id=seg_id,
            source_plain=src,
            target_plain=tgt,
            source_raw=src,
            target_raw=tgt,
            file_name=file_name,
            match_percent=match_pct,
            is_locked=False,
            target_element=tgt_cell_elem,
            parent_element=None,
        ))

    # Try to infer language from filename if not found in XML
    if not target_language:
        stem = path_obj.stem
        parts = stem.split("_")
        if parts and re.match(r"^[a-z]{2}(-[A-Z]{2})?$", parts[0]):
            target_language = parts[0]

    if not segments:
        raise ValueError(
            "No bilingual segments found. "
            "Make sure the file is a Phrase / CAT tool bilingual docx export "
            "with a source/target table."
        )

    return DocxDocument(
        path=str(path_obj),
        root=root,
        zip_names=zip_names,
        zip_contents=zip_contents,
        doc_xml_name=doc_xml_name,
        segments=segments,
        target_language=target_language,
    )


# ── Save function ─────────────────────────────────────────────────────────────

def save_phrase_docx(
    doc: DocxDocument,
    edits: Dict[str, str],
    output_path: Optional[str] = None,
    backup: bool = True,
) -> str:
    """
    Apply *edits* (mapping segment_id → new_target_text) to the document
    and write the result to *output_path* (defaults to the original path).

    If *backup* is True, a timestamped copy of the original is written to
    the same directory before overwriting.

    Returns the path that was written.
    """
    # Build a lookup of segment_id → DocxSegment
    seg_map = {s.id: s for s in doc.segments}

    # Detect dominant target language (used when rebuilding runs)
    lang = doc.target_language or "nb-NO"

    # Apply each edit to the live XML tree
    changed = 0
    for seg_id, new_text in edits.items():
        seg = seg_map.get(seg_id)
        if seg is None or seg.target_element is None:
            continue
        _update_target_cell(seg.target_element, new_text, lang)
        # Keep the in-memory segment in sync
        seg.target_plain = new_text
        seg.target_raw   = new_text
        changed += 1

    if changed == 0:
        return doc.path  # nothing to write

    out_path = Path(output_path) if output_path else Path(doc.path)

    # Backup original
    if backup and out_path.exists():
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = out_path.with_suffix(f".bak_{ts}.docx")
        shutil.copy2(str(out_path), str(backup_path))

    # Serialise the modified XML tree
    new_xml_bytes = etree.tostring(
        doc.root, xml_declaration=True, encoding="UTF-8", standalone=True
    )

    # Repack the zip, replacing document.xml with the new version
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf_out:
        for name in doc.zip_names:
            if name == doc.doc_xml_name:
                zf_out.writestr(name, new_xml_bytes)
            else:
                zf_out.writestr(name, doc.zip_contents[name])

    out_path.write_bytes(buf.getvalue())
    return str(out_path)
