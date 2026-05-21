"""
Termlist and checklist parsers for SpellcheckQA.
Supports: CSV, TBX (TermBase eXchange), Xbench XML checklists.
"""

import csv
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

from lxml import etree


@dataclass
class TermEntry:
    source: str
    target: Optional[str]  # None for DNT (Do Not Translate) entries
    entry_type: str        # "dnt" | "required" | "forbidden" | "generic"


@dataclass
class CheckRule:
    pattern: str
    target_pattern: Optional[str]
    check_type: str          # "source_not_in_target" | "forbidden_in_target" | "pattern_match"
    case_sensitive: bool
    description: str
    is_regex: bool = False   # False = word-boundary matching; True = raw regex


# ─── CSV ─────────────────────────────────────────────────────────────────────

def parse_csv(path: str, entry_type: str = "required") -> List[TermEntry]:
    """
    Parse a CSV termlist.
    - Two-column: col0 = source term, col1 = target term
    - One-column: col0 = term (treated as DNT if entry_type='dnt', else 'required')
    """
    entries: List[TermEntry] = []
    try:
        with open(path, "r", encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f)
            for row in reader:
                if not row or row[0].startswith("#"):
                    continue
                source = row[0].strip()
                if not source:
                    continue
                target = row[1].strip() if len(row) > 1 and row[1].strip() else None
                etype = entry_type if target else "dnt"
                entries.append(TermEntry(source=source, target=target, entry_type=etype))
    except Exception as e:
        print(f"Failed to parse CSV {path}: {e}", file=sys.stderr)
    return entries


# ─── TBX ─────────────────────────────────────────────────────────────────────

_TBX_NS = {
    "tbx": "urn:iso:std:iso:30042:ed-2",
}

# Administrative status values that indicate DNT or forbidden
_DNT_STATUS = {"notRecommended", "superseded", "deprecatedTerm"}
_FORBIDDEN_STATUS = {"forbidden"}


def _lang_code_base(code: str) -> str:
    """Return the base language code: 'nb-NO' → 'nb', 'en-US' → 'en'."""
    return code.split("-")[0].split("_")[0].lower() if code else ""


def parse_tbx(path: str, source_lang: str = "en", target_lang: str = "") -> List[TermEntry]:
    """
    Parse a TBX (ISO 30042) termlist.

    Uses xml:lang attributes to pick the correct source and target langSets.
    Falls back to positional (first=source, second=target) when language codes
    are absent or don't match, so older/simpler TBX files still work.

    Detects DNT/forbidden via <termNote type="administrativeStatus">.
    """
    entries: List[TermEntry] = []
    try:
        tree = etree.parse(path)
        root = tree.getroot()

        # TBX files may or may not use a namespace — build helpers that work either way
        nsmap = root.nsmap
        default_ns = nsmap.get(None, "")
        ns = {"t": default_ns} if default_ns else {}

        def find_all_ns(parent, tag):
            if ns:
                return parent.findall(f"t:{tag}", namespaces=ns)
            return parent.findall(tag)

        term_entries = (
            root.findall(".//t:termEntry", namespaces=ns)
            if ns
            else root.findall(".//termEntry")
        )

        src_base = _lang_code_base(source_lang)
        tgt_base = _lang_code_base(target_lang)

        for entry in term_entries:
            lang_sets = find_all_ns(entry, "langSet")
            if not lang_sets:
                continue

            # Build a map of base-language-code → langSet element
            lang_map: dict = {}
            for ls in lang_sets:
                lang_attr = ls.get("{http://www.w3.org/XML/1998/namespace}lang") or ls.get("lang") or ls.get("xml:lang") or ""
                base = _lang_code_base(lang_attr)
                if base and base not in lang_map:
                    lang_map[base] = ls

            # Select source langSet: prefer explicit language match, fall back to first
            if src_base and src_base in lang_map:
                source_ls = lang_map[src_base]
            else:
                source_ls = lang_sets[0]

            # Select target langSet: prefer explicit language match, fall back to second
            if tgt_base and tgt_base in lang_map and lang_map[tgt_base] is not source_ls:
                target_ls = lang_map[tgt_base]
            elif len(lang_sets) >= 2:
                # Pick any langSet that isn't the source
                target_ls = next((ls for ls in lang_sets if ls is not source_ls), None)
            else:
                target_ls = None

            source_terms = _extract_terms_from_langset(source_ls, ns)
            target_terms = _extract_terms_from_langset(target_ls, ns) if target_ls else []

            if not source_terms:
                continue

            source = source_terms[0]["term"]
            entry_type = source_terms[0]["status"]
            target = target_terms[0]["term"] if target_terms else None

            entries.append(TermEntry(source=source, target=target, entry_type=entry_type))

    except Exception as e:
        print(f"Failed to parse TBX {path}: {e}", file=sys.stderr)
    return entries


def _extract_terms_from_langset(lang_set, ns) -> list:
    """Extract terms and their administrative status from a langSet element."""
    if lang_set is None:
        return []
    results = []

    # Search for tig/ntig containers using localname matching so namespace
    # handling is not needed separately for these nested elements
    containers = [el for el in lang_set.iter() if etree.QName(el).localname in ("tig", "ntig")]
    if not containers:
        containers = [lang_set]

    for container in containers:
        # Find <term> by localname to avoid namespace issues
        term_elem = None
        for child in container:
            if etree.QName(child).localname == "term":
                term_elem = child
                break
        if term_elem is None or not term_elem.text:
            continue

        term_text = term_elem.text.strip()

        # Look for administrativeStatus note
        status = "required"
        for note in container.iter():
            if etree.QName(note).localname == "termNote":
                note_type = note.get("type", "")
                if note_type == "administrativeStatus" and note.text:
                    val = note.text.strip()
                    if val in _DNT_STATUS:
                        status = "dnt"
                    elif val in _FORBIDDEN_STATUS:
                        status = "forbidden"

        results.append({"term": term_text, "status": status})
    return results


# ─── Xbench XML ──────────────────────────────────────────────────────────────

def parse_xbench(path: str) -> List[CheckRule]:
    """
    Parse an Xbench XML checklist.
    Extracts <check> elements with source/target patterns.
    """
    rules: List[CheckRule] = []
    try:
        tree = etree.parse(path)
        root = tree.getroot()

        for check in root.iter("check"):
            # Support both <source>/<target> and <term type="source">/<term type="target">
            source_elem = check.find("source")
            target_elem = check.find("target")
            if source_elem is None:
                source_elem = check.find("term[@type='source']")
            if target_elem is None:
                target_elem = check.find("term[@type='target']")
            if source_elem is None and target_elem is None:
                continue

            source_pattern = source_elem.text.strip() if source_elem is not None and source_elem.text else ""
            target_pattern = target_elem.text.strip() if target_elem is not None and target_elem.text else ""

            # searchmode="regex" means the pattern is a regex; anything else is plain text
            source_mode = source_elem.get("searchmode", "simple") if source_elem is not None else "simple"
            target_mode = target_elem.get("searchmode", "simple") if target_elem is not None else "simple"
            is_regex = source_mode == "regex" or target_mode == "regex"

            # Description: prefer <description> text, fall back to check name= attribute
            desc_elem = check.find("description")
            if desc_elem is not None and desc_elem.text and desc_elem.text.strip():
                description = desc_elem.text.strip()
            else:
                description = check.get("name", "")

            case_sensitive = check.get("caseSensitive", "false").lower() == "true"

            # Determine check type
            if source_pattern and not target_pattern:
                check_type = "source_not_in_target"
            elif target_pattern and not source_pattern:
                check_type = "forbidden_in_target"
            else:
                check_type = "pattern_match"

            rules.append(
                CheckRule(
                    pattern=source_pattern,
                    target_pattern=target_pattern or None,
                    check_type=check_type,
                    case_sensitive=case_sensitive,
                    description=description,
                    is_regex=is_regex,
                )
            )

    except Exception as e:
        print(f"Failed to parse Xbench checklist {path}: {e}", file=sys.stderr)
    return rules


# ─── Dispatcher ──────────────────────────────────────────────────────────────

def load_termlist(path: str, source_lang: str = "en", target_lang: str = "") -> List[TermEntry]:
    """Load a termlist file based on its extension.

    source_lang / target_lang are used for TBX files to select the correct
    langSet pair. They are ignored for CSV files.
    """
    ext = Path(path).suffix.lower()
    if ext == ".csv":
        return parse_csv(path)
    elif ext in (".tbx", ".tbx2"):
        return parse_tbx(path, source_lang=source_lang, target_lang=target_lang)
    else:
        print(f"Unsupported termlist format: {ext}", file=sys.stderr)
        return []


def load_checklist(path: str) -> List[CheckRule]:
    """Load a checklist file (Xbench XML)."""
    return parse_xbench(path)
