"""
DOCX Bilingual Table Parser — Phrase / CAT tool export format.

Parses bilingual Word (.docx) tables exported from Phrase and similar
CAT tools. Extracts source/target segment pairs from the table structure.

Phrase en-no-T structure (separate tables in document):
  Table 0: instruction row (1 column, ignored)
  Table 1: metadata row (7 columns: lang codes, job info — ignored)
  Table 2: header row (7 columns: ID, ICU, #, Source (en), Target (no), <empty>, Comment)
  Table 3: data rows (7 columns per segment):
            0=key, 1=ICU flag, 2=seq#, 3=source, 4=target, 5=match%, 6=comment

The column layout is auto-detected from the header table row.

Returns a list of DocxSegment objects compatible with SpellcheckQA modules.
"""

import zipfile
import re
from pathlib import Path
from typing import List, Optional
from dataclasses import dataclass, field

try:
    from lxml import etree
    _HAS_LXML = True
except ImportError:
    import xml.etree.ElementTree as etree
    _HAS_LXML = False


# Word namespace
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def _tag(local: str) -> str:
    return f"{{{W}}}{local}"


@dataclass
class DocxSegment:
    """A bilingual segment extracted from a docx table."""
    id: str
    source_plain: str
    target_plain: str
    source_raw: str
    target_raw: str
    file_name: str
    match_percent: Optional[int] = None
    is_locked: bool = False
    target_element: object = field(default=None, repr=False)
    parent_element: object = field(default=None, repr=False)


def _get_cell_text(cell_elem) -> str:
    """Extract all text runs from a table cell, concatenating them."""
    parts = []
    for t in cell_elem.iter(_tag("t")):
        parts.append(t.text or "")
    return "".join(parts).strip()


def _get_table_rows_as_text(table) -> List[List[str]]:
    """Return all rows of a table as lists of cell text strings."""
    result = []
    for row in table.findall(_tag("tr")):
        cells = list(row.findall(_tag("tc")))
        if cells:
            result.append([_get_cell_text(c) for c in cells])
    return result


def _detect_layout_from_header(header_cells: List[str]) -> dict:
    """
    Analyse a header row to find column indices for:
      key, icu, seq, source, target, match, comment

    Returns a dict mapping role → column index (None if not found).
    """
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
        elif t in ("#", "seq", "no.", "nr", "no") or (t.isdigit()):
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

    # Fallback: if source not found, infer from position
    if layout["source"] is None and layout["target"] is None:
        n = len(header_cells)
        if n >= 7:
            layout["key"] = layout["key"] or 0
            layout["seq"] = layout["seq"] or 2
            layout["source"] = 3
            layout["target"] = 4
            layout["match"] = 5
        elif n == 5:
            layout["key"] = 0
            layout["seq"] = 2
            layout["source"] = 3
            layout["target"] = 4
        elif n == 4:
            layout["seq"] = 0
            layout["source"] = 1
            layout["target"] = 2
            layout["match"] = 3
        elif n >= 2:
            layout["source"] = 0
            layout["target"] = 1

    # If match column is still unset but there is a column between target and comment,
    # assume it holds the TM match percentage (Phrase omits a label for this column).
    if layout["match"] is None and layout["target"] is not None:
        tgt_col = layout["target"]
        cmt_col = layout.get("comment")
        n = len(header_cells)
        if cmt_col is not None and cmt_col > tgt_col + 1:
            layout["match"] = tgt_col + 1
        elif cmt_col is None and tgt_col + 1 < n:
            layout["match"] = tgt_col + 1

    return layout


def _heuristic_layout(n_cols: int) -> dict:
    """Guess column layout purely from column count, no header available."""
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


def _is_instruction_row(cells: List[str]) -> bool:
    """Single-cell rows with long instruction text → skip."""
    return len(cells) == 1 and len(cells[0]) > 20


def parse_phrase_docx(path: str) -> List[DocxSegment]:
    """
    Parse a bilingual docx table export (Phrase / CAT tool) and return
    a list of DocxSegment objects.

    Strategy:
    1. Extract all tables from word/document.xml.
    2. Find the header table — a single-row table whose cells contain
       recognisable column names (ID, #, Source, Target, …).
    3. The next table with multiple rows is the data table.
    4. Alternatively, find a data table with an embedded header row (grey shading).
    5. Parse each data row using the column layout from the header.
    """
    path_obj = Path(path)
    if not path_obj.exists():
        raise FileNotFoundError(f"File not found: {path}")

    with zipfile.ZipFile(str(path_obj), "r") as zf:
        names = zf.namelist()
        doc_name = next(
            (n for n in names if n.lower().endswith("word/document.xml")), None
        )
        if doc_name is None:
            raise ValueError("Not a valid docx file: missing word/document.xml")
        xml_bytes = zf.read(doc_name)

    if _HAS_LXML:
        root = etree.fromstring(xml_bytes)
    else:
        root = etree.fromstring(xml_bytes.decode("utf-8"))

    file_name = path_obj.name
    tables = list(root.iter(_tag("tbl")))

    if not tables:
        raise ValueError("No tables found in this docx file.")

    # ── Pass 1: collect all table row data ───────────────────────────────────
    table_rows: List[List[List[str]]] = [
        _get_table_rows_as_text(t) for t in tables
    ]

    # ── Pass 2: find header table & layout ───────────────────────────────────
    layout = None
    data_table_idx = None

    # A header table is a single-row table whose cells look like column names
    # (contains "source", "#", "id", etc.)
    HEADER_KEYWORDS = {"id", "source", "target", "#", "seq", "icu", "comment",
                       "key", "match", "tm"}

    for ti, rows in enumerate(table_rows):
        if not rows:
            continue
        # Check if this table has a recognisable header row (first or only row)
        candidate = rows[0]
        lower_texts = {c.strip().lower() for c in candidate}
        hits = lower_texts & HEADER_KEYWORDS
        if hits and len(candidate) >= 2:
            layout = _detect_layout_from_header(candidate)
            # Data is in the NEXT multi-row table
            for j in range(ti + 1, len(table_rows)):
                if len(table_rows[j]) > 1:
                    data_table_idx = j
                    break
            if data_table_idx is not None:
                break

    # ── Pass 3: fallback — look for embedded header row (grey shading) ───────
    if layout is None:
        for ti, table_elem in enumerate(tables):
            rows_elem = list(table_elem.findall(_tag("tr")))
            if len(rows_elem) < 2:
                continue
            for ri, row_elem in enumerate(rows_elem):
                cells = list(row_elem.findall(_tag("tc")))
                if not cells:
                    continue
                shd = row_elem.find(f".//{_tag('shd')}")
                if shd is None:
                    # Check cells for grey shading
                    for c in cells:
                        shd = c.find(f".//{_tag('shd')}")
                        if shd is not None:
                            break
                if shd is not None:
                    fill = (shd.get(_tag("fill"), "")
                            or shd.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}fill", ""))
                    if fill.upper() in ("D9D9D9", "BFBFBF", "C0C0C0", "808080"):
                        header_cells = [_get_cell_text(c) for c in cells]
                        candidate_layout = _detect_layout_from_header(header_cells)
                        if (candidate_layout["source"] is not None
                                and candidate_layout["target"] is not None):
                            layout = candidate_layout
                            data_table_idx = ti
                            # Skip embedded header rows by slicing data below
                            break
            if layout is not None:
                break

    # ── Pass 4: absolute fallback — largest table, heuristic layout ──────────
    if layout is None:
        # Pick the table with the most rows that has >= 2 columns
        best = max(
            ((ti, rows) for ti, rows in enumerate(table_rows)
             if rows and len(rows[0]) >= 2),
            key=lambda x: len(x[1]),
            default=None
        )
        if best is None:
            raise ValueError("No bilingual table found in this docx file.")
        data_table_idx = best[0]
        n_cols = len(table_rows[data_table_idx][0])
        layout = _heuristic_layout(n_cols)

    # ── Extract segments ──────────────────────────────────────────────────────
    data_rows = table_rows[data_table_idx]
    segments: List[DocxSegment] = []
    seg_counter = 0

    for row_cells in data_rows:
        if not row_cells:
            continue
        if _is_instruction_row(row_cells):
            continue

        src = _cell(row_cells, layout.get("source"))
        tgt = _cell(row_cells, layout.get("target"))

        # Skip rows where both source and target are empty
        if not src and not tgt:
            continue

        # Skip rows that look like (embedded) header rows
        if src.strip().lower() in ("source", "source text", "source (en)", "src"):
            continue

        # Build segment ID
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
        ))

    if not segments:
        raise ValueError(
            "No bilingual segments found. "
            "Make sure the file is a Phrase / CAT tool bilingual docx export "
            "with a source/target table."
        )

    return segments
