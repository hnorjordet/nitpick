"""
QA checker for SpellcheckQA — Xbench-style quality assurance checks.

Checks:
- Untranslated segments
- Source = Target
- Inconsistent translations (same source → different targets)
- Inconsistent translations (same target → different sources)
- Tag mismatches (inline tags differ between source and target)
- URL/Email mismatches
- Alphanumeric token mismatches
- Double blanks in target
- Repeated words in target
- UPPERCASE word mismatches
- CamelCase word mismatches
"""

import re
from collections import defaultdict
from typing import Dict, List

from terminology.term_checker import Violation
from qachecks.number_checker import _TAG_RE

# All available QA check IDs
ALL_QA_CHECKS = [
    "untranslated",
    "source_equals_target",
    "inconsistent_source",
    "inconsistent_target",
    "tag_mismatch",
    "url_email_mismatch",
    "alphanumeric_mismatch",
    "double_blanks",
    "repeated_words",
    "uppercase_mismatch",
    "camelcase_mismatch",
]

# ─── Regex patterns ──────────────────────────────────────────────────────────

_URL_EMAIL_RE = re.compile(
    r"https?://\S+|[\w.+-]+@[\w-]+\.[\w.-]+", re.IGNORECASE
)

# Alphanumeric tokens: must contain both letters and digits, at least 2 chars
_ALPHANUM_RE = re.compile(
    r"\b(?=[A-Za-z]*\d)(?=\d*[A-Za-z])[A-Za-z\d]{2,}\b"
)

_DOUBLE_BLANK_RE = re.compile(r"  ")

# Repeated consecutive words (case-insensitive)
_REPEATED_WORD_RE = re.compile(r"\b(\w+)\s+\1\b", re.IGNORECASE | re.UNICODE)

# UPPERCASE words: 2+ uppercase letters (includes Norwegian chars)
_UPPERCASE_RE = re.compile(r"\b[A-ZÆØÅÉÈÊËÀÂÄÖÜ]{2,}\b")

# CamelCase words: start uppercase, then alternating lower/upper
_CAMELCASE_RE = re.compile(r"\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b")


# ─── Per-segment checks ─────────────────────────────────────────────────────

def _v(seg, vtype: str, source_term: str, target_term, description: str) -> Violation:
    """Helper to build a Violation from a segment."""
    return Violation(
        segment_id=seg.id,
        file_name=seg.file_name,
        violation_type=vtype,
        source_term=source_term,
        target_term=target_term,
        description=description,
        source_text=seg.source_plain,
        target_text=seg.target_plain,
        check_source="qa",
    )


def _check_untranslated(seg) -> List[Violation]:
    if not seg.target_plain.strip():
        return [_v(seg, "untranslated", "", None, "Target segment is empty (untranslated)")]
    return []


def _check_source_equals_target(seg) -> List[Violation]:
    s = seg.source_plain.strip()
    t = seg.target_plain.strip()
    if not s or not t:
        return []
    # Skip very short segments (likely abbreviations, numbers) and number-only
    if len(s) <= 2 or re.fullmatch(r"[\d\s.,;:!?%€$£¥#@&*()\-/\\]+", s):
        return []
    if s == t:
        return [_v(seg, "source_equals_target", s[:60], t[:60],
                     "Target is identical to source")]
    return []


def _check_tag_mismatch(seg) -> List[Violation]:
    src_tags = sorted(_TAG_RE.findall(seg.source_raw))
    tgt_tags = sorted(_TAG_RE.findall(seg.target_raw))
    if src_tags != tgt_tags:
        missing = [t for t in src_tags if t not in tgt_tags]
        extra = [t for t in tgt_tags if t not in src_tags]
        parts = []
        if missing:
            parts.append(f"missing in target: {', '.join(missing)}")
        if extra:
            parts.append(f"extra in target: {', '.join(extra)}")
        return [_v(seg, "tag_mismatch",
                    ", ".join(src_tags) if src_tags else "(none)",
                    ", ".join(tgt_tags) if tgt_tags else "(none)",
                    "Tag mismatch — " + "; ".join(parts))]
    return []


def _check_url_email_mismatch(seg) -> List[Violation]:
    src_set = set(_URL_EMAIL_RE.findall(seg.source_plain))
    tgt_set = set(_URL_EMAIL_RE.findall(seg.target_plain))
    if src_set != tgt_set:
        missing = src_set - tgt_set
        extra = tgt_set - src_set
        parts = []
        if missing:
            parts.append(f"missing in target: {', '.join(sorted(missing))}")
        if extra:
            parts.append(f"extra in target: {', '.join(sorted(extra))}")
        return [_v(seg, "url_email_mismatch",
                    ", ".join(sorted(src_set)) if src_set else "(none)",
                    ", ".join(sorted(tgt_set)) if tgt_set else "(none)",
                    "URL/Email mismatch — " + "; ".join(parts))]
    return []


def _check_alphanumeric_mismatch(seg) -> List[Violation]:
    src_set = set(_ALPHANUM_RE.findall(seg.source_plain))
    tgt_set = set(_ALPHANUM_RE.findall(seg.target_plain))
    if src_set != tgt_set:
        missing = src_set - tgt_set
        extra = tgt_set - src_set
        parts = []
        if missing:
            parts.append(f"missing in target: {', '.join(sorted(missing))}")
        if extra:
            parts.append(f"extra in target: {', '.join(sorted(extra))}")
        return [_v(seg, "alphanumeric_mismatch",
                    ", ".join(sorted(src_set)) if src_set else "(none)",
                    ", ".join(sorted(tgt_set)) if tgt_set else "(none)",
                    "Alphanumeric mismatch — " + "; ".join(parts))]
    return []


def _check_double_blanks(seg) -> List[Violation]:
    if _DOUBLE_BLANK_RE.search(seg.target_plain):
        return [_v(seg, "double_blanks", "", None,
                    "Double blanks (consecutive spaces) found in target")]
    return []


def _check_repeated_words(seg) -> List[Violation]:
    m = _REPEATED_WORD_RE.search(seg.target_plain)
    if m:
        word = m.group(1)
        return [_v(seg, "repeated_words", word, None,
                    f'Repeated word in target: "{word} {word}"')]
    return []


def _check_uppercase_mismatch(seg) -> List[Violation]:
    src_words = set(_UPPERCASE_RE.findall(seg.source_plain))
    if not src_words:
        return []
    tgt_text = seg.target_plain
    missing = {w for w in src_words if w not in tgt_text}
    if missing:
        return [_v(seg, "uppercase_mismatch",
                    ", ".join(sorted(missing)), None,
                    f"UPPERCASE word(s) in source missing from target: {', '.join(sorted(missing))}")]
    return []


def _check_camelcase_mismatch(seg) -> List[Violation]:
    src_words = set(_CAMELCASE_RE.findall(seg.source_plain))
    if not src_words:
        return []
    tgt_text = seg.target_plain
    missing = {w for w in src_words if w not in tgt_text}
    if missing:
        return [_v(seg, "camelcase_mismatch",
                    ", ".join(sorted(missing)), None,
                    f"CamelCase word(s) in source missing from target: {', '.join(sorted(missing))}")]
    return []


# ─── Cross-segment checks ───────────────────────────────────────────────────

def _check_inconsistent_same_source(segments, skip_locked: bool) -> List[Violation]:
    """Flag segments where the same source text has different translations."""
    groups = defaultdict(list)
    for seg in segments:
        if skip_locked and seg.is_locked:
            continue
        s = seg.source_plain.strip()
        t = seg.target_plain.strip()
        if not s or not t:
            continue
        groups[s].append(seg)

    violations = []
    for source_text, segs in groups.items():
        distinct_targets = {s.target_plain.strip() for s in segs}
        if len(distinct_targets) > 1:
            target_list = ", ".join(f'"{t[:40]}"' for t in sorted(distinct_targets))
            for seg in segs:
                violations.append(_v(
                    seg, "inconsistent_source",
                    source_text[:60], seg.target_plain.strip()[:60],
                    f"Same source has {len(distinct_targets)} different translations: {target_list}",
                ))
    return violations


def _check_inconsistent_same_target(segments, skip_locked: bool) -> List[Violation]:
    """Flag segments where the same target text maps to different sources."""
    groups = defaultdict(list)
    for seg in segments:
        if skip_locked and seg.is_locked:
            continue
        s = seg.source_plain.strip()
        t = seg.target_plain.strip()
        if not s or not t:
            continue
        groups[t].append(seg)

    violations = []
    for target_text, segs in groups.items():
        distinct_sources = {s.source_plain.strip() for s in segs}
        if len(distinct_sources) > 1:
            source_list = ", ".join(f'"{s[:40]}"' for s in sorted(distinct_sources))
            for seg in segs:
                violations.append(_v(
                    seg, "inconsistent_target",
                    seg.source_plain.strip()[:60], target_text[:60],
                    f"Same target has {len(distinct_sources)} different sources: {source_list}",
                ))
    return violations


# ─── Main entry point ────────────────────────────────────────────────────────

# Map of check ID → per-segment checker function
_PER_SEGMENT_CHECKS = {
    "untranslated": _check_untranslated,
    "source_equals_target": _check_source_equals_target,
    "tag_mismatch": _check_tag_mismatch,
    "url_email_mismatch": _check_url_email_mismatch,
    "alphanumeric_mismatch": _check_alphanumeric_mismatch,
    "double_blanks": _check_double_blanks,
    "repeated_words": _check_repeated_words,
    "uppercase_mismatch": _check_uppercase_mismatch,
    "camelcase_mismatch": _check_camelcase_mismatch,
}


def run_qa_checks(
    segments,
    enabled_checks: Dict[str, bool],
    skip_locked: bool = True,
) -> List[Violation]:
    """
    Run enabled QA checks on all segments.
    Returns a list of Violation objects (reuses the Violation dataclass
    from term_checker for UI compatibility).
    """
    violations: List[Violation] = []

    # Determine which per-segment checks are active
    active_per_seg = [
        (check_id, fn)
        for check_id, fn in _PER_SEGMENT_CHECKS.items()
        if enabled_checks.get(check_id, False)
    ]

    # Per-segment pass
    for seg in segments:
        if skip_locked and seg.is_locked:
            continue
        # Untranslated check runs on all segments; other checks need both texts
        for check_id, fn in active_per_seg:
            if check_id != "untranslated" and not seg.target_plain.strip():
                continue
            violations.extend(fn(seg))

    # Cross-segment checks
    if enabled_checks.get("inconsistent_source", False):
        violations.extend(_check_inconsistent_same_source(segments, skip_locked))

    if enabled_checks.get("inconsistent_target", False):
        violations.extend(_check_inconsistent_same_target(segments, skip_locked))

    return violations
