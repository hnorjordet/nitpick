"""
Number, placeholder, and formatting checker for SpellcheckQA.

Compares source and target segments to detect:
- Missing or extra numbers
- Missing placeholders ({0}, %s, %d, {{variable}}, etc.)
- Unpaired/mismatched bracket and quote symbols
"""

import re
from typing import List, Set, Tuple

from terminology.term_checker import Violation


# ─── Extraction patterns ─────────────────────────────────────────────────────

# Numbers: integers, decimals, negatives — but not bare single digits that
# are likely articles/prepositions in some languages.  We require at least
# two digits OR a digit with decimal/thousand separators.
_NUMBER_RE = re.compile(
    r"""
    -?                         # optional negative sign
    (?:
        \d{1,3}(?:[.,\s]\d{3})+  # thousand-grouped: 1,000  1.000  1 000
        (?:[.,]\d+)?             # optional decimal part
    |
        \d+[.,]\d+               # simple decimal: 3.14  3,14
    |
        \d{2,}                   # plain integer ≥ 2 digits: 42, 100
    )
    (?:%|‰)?                   # optional trailing percent/permille
    """,
    re.VERBOSE,
)

# Placeholders: {0}, {name}, {{variable}}, %s, %d, %1$s, %(name)s, etc.
_PLACEHOLDER_RE = re.compile(
    r"""
    \{\{[\w.]+\}\}             # {{variable}}, {{obj.prop}}
    | \{[\w.]+\}               # {0}, {name}, {obj.prop}
    | %[%dsfioxXeEgGcr]        # printf: %s, %d, %f (but NOT lone %)
    | %\d+\$[dsfioxXeEgGcr]   # positional printf: %1$s, %2$d
    | %\([\w.]+\)[dsfioxXeEgGcr]  # Python named: %(name)s
    | &lt;\w+/?&gt;            # escaped XML tags: &lt;br/&gt;
    | <\w+/?>                  # raw XML/HTML tags: <br/>, <b>
    """,
    re.VERBOSE,
)

# Standalone tags like <br>, <br/>, </b>, <img src="...">, etc.
# These are inline formatting tags that should be preserved.
_TAG_RE = re.compile(r"</?[a-zA-Z][^>]*>")


def _extract_numbers(text: str) -> List[str]:
    """Extract all number tokens from text, normalized for comparison."""
    matches = _NUMBER_RE.findall(text)
    # Normalize: strip spaces, convert commas used as decimal separators
    # We keep the raw matched string for display, but normalize for comparison
    return sorted(matches)


def _normalize_number(n: str) -> str:
    """Normalize a number string for comparison.

    Strips thousand separators (comma, period, space, non-breaking space)
    to produce a canonical numeric form so that 3,500 == 3.500 == 3 500.

    For decimal separators: if the number ends with a separator followed
    by exactly 1-2 digits or 4+ digits, treat it as a decimal point.
    Otherwise (exactly 3 digits after separator) treat as thousands.
    """
    s = n.strip().replace("\u00a0", " ").replace("%", "").replace("‰", "")

    # Handle trailing percent/permille — already stripped above, just get the number
    # Detect decimal part: last separator + non-3-digit group
    import re
    m = re.match(r'^(-?\d[\d,.\s]*)([.,])(\d+)$', s)
    if m:
        integer_part = m.group(1)
        sep = m.group(2)
        frac = m.group(3)
        # If the fractional part has exactly 3 digits, it's ambiguous
        # but in context of a number like 3,500 vs 3.500 it's thousands.
        # If it has 1, 2, or 4+ digits, it's definitely decimal.
        if len(frac) != 3:
            # Decimal separator — strip thousands from integer part
            integer_clean = re.sub(r'[,.\s]', '', integer_part)
            return f"{integer_clean}.{frac}"
        else:
            # Ambiguous 3-digit group — treat as thousands separator
            return re.sub(r'[,.\s]', '', s)
    else:
        # No decimal part — just strip all separators
        return re.sub(r'[,.\s]', '', s)


def _extract_placeholders(text: str) -> Set[str]:
    """Extract all placeholder tokens from text."""
    return set(_PLACEHOLDER_RE.findall(text))


def _extract_tags(text: str) -> List[str]:
    """Extract inline tags from text."""
    return sorted(_TAG_RE.findall(text))


# ─── Quote normalisation ──────────────────────────────────────────────────────

# All quote characters that can substitute for one another across languages.
# Used to count "total quotes" in a locale-neutral way.
_DOUBLE_QUOTE_CHARS = frozenset('"„\u201c\u201d\u00ab\u00bb')  # " „ " " « »
_SINGLE_QUOTE_CHARS = frozenset("'\u2018\u2019\u2039\u203a")   # ' ' ' ‹ ›


def _count_double_quotes(text: str) -> int:
    return sum(text.count(ch) for ch in _DOUBLE_QUOTE_CHARS)


def _count_single_quotes(text: str) -> int:
    return sum(text.count(ch) for ch in _SINGLE_QUOTE_CHARS)


# ─── Unpaired symbol checker ──────────────────────────────────────────────────

# Bracket pairs: (open, close, display_name)
# Checked for both internal balance AND source/target count match.
_BRACKET_PAIRS: List[Tuple[str, str, str]] = [
    ("(", ")", "parentheses ()"),
    ("[", "]", "square brackets []"),
    ("{", "}", "curly braces {}"),
]

# Directional quote pairs: open ≠ close.
# Only checked for internal balance in target — NOT for source/target count
# match, because the source language may use different quote style.
_DIRECTIONAL_PAIRS: List[Tuple[str, str, str]] = [
    ("\u00ab", "\u00bb", "guillemets «»"),
    ("\u2018", "\u2019", "single curly quotes \u2018\u2019"),
    ("\u201c", "\u201d", "double curly quotes \u201c\u201d"),
    ("\u201e", "\u201c", "German/Polish quotes \u201e\u201c"),
    ("\u2039", "\u203a", "single guillemets \u2039\u203a"),
]


def _check_brackets(text: str, open_ch: str, close_ch: str) -> Tuple[int, int]:
    """Return (unmatched_opens, unmatched_closes) in text."""
    depth = 0
    unmatched_closes = 0
    for ch in text:
        if ch == open_ch:
            depth += 1
        elif ch == close_ch:
            if depth > 0:
                depth -= 1
            else:
                unmatched_closes += 1
    return depth, unmatched_closes  # depth = unmatched opens


def _check_unpaired_symbols(
    seg_id: str,
    file_name: str,
    source: str,
    target: str,
    match_percent=None,
) -> List[Violation]:
    """
    Check source and target for unpaired bracket/quote symbols.

    Two kinds of problems are reported:
    1. Internal imbalance in the TARGET (e.g. "foo)" without a matching "(")
    2. Count mismatch between source and target for a given symbol type
       (e.g. source has 2 pairs of «», target has 1)
    """
    violations: List[Violation] = []

    # ── Bracket pairs ─────────────────────────────────────────────────
    for open_ch, close_ch, label in _BRACKET_PAIRS:
        # Check internal balance of target
        unmatched_opens, unmatched_closes = _check_brackets(target, open_ch, close_ch)
        if unmatched_opens or unmatched_closes:
            parts = []
            if unmatched_opens:
                parts.append(f"{unmatched_opens} unclosed '{open_ch}'")
            if unmatched_closes:
                parts.append(f"{unmatched_closes} unopened '{close_ch}'")
            violations.append(Violation(
                segment_id=seg_id,
                file_name=file_name,
                violation_type="unpaired_symbol",
                source_term=label,
                target_term=None,
                description=f"Unpaired {label} in target: {'; '.join(parts)}",
                source_text=source,
                target_text=target,
                check_source="number",
                match_percent=match_percent,
            ))
        else:
            # Target is internally balanced — check count matches source
            src_opens = source.count(open_ch)
            tgt_opens = target.count(open_ch)
            if src_opens != tgt_opens:
                diff = tgt_opens - src_opens
                direction = "extra" if diff > 0 else "missing"
                violations.append(Violation(
                    segment_id=seg_id,
                    file_name=file_name,
                    violation_type="unpaired_symbol",
                    source_term=label,
                    target_term=None,
                    description=(
                        f"Count mismatch for {label}: "
                        f"source has {src_opens} pair(s), target has {tgt_opens} — "
                        f"{abs(diff)} {direction} in target"
                    ),
                    source_text=source,
                    target_text=target,
                    check_source="number",
                ))

    # ── Directional quote pairs ────────────────────────────────────────
    # Only check internal balance in the TARGET — do NOT compare counts with
    # source, because source may use a different quote style (e.g. "word" in
    # English source vs «word» in Norwegian target is correct, not an error).
    for open_ch, close_ch, label in _DIRECTIONAL_PAIRS:
        unmatched_opens, unmatched_closes = _check_brackets(target, open_ch, close_ch)
        if unmatched_opens or unmatched_closes:
            parts = []
            if unmatched_opens:
                parts.append(f"{unmatched_opens} unclosed '{open_ch}'")
            if unmatched_closes:
                parts.append(f"{unmatched_closes} unopened '{close_ch}'")
            violations.append(Violation(
                segment_id=seg_id,
                file_name=file_name,
                violation_type="unpaired_symbol",
                source_term=label,
                target_term=None,
                description=f"Unpaired {label} in target: {'; '.join(parts)}",
                source_text=source,
                target_text=target,
                check_source="number",
                match_percent=match_percent,
            ))

    # ── Quote count balance (locale-neutral) ───────────────────────────
    # Compare total double-quote count and total single-quote count across
    # ALL quote styles combined, so "word" in source matches «word» in target.
    # Only flag if the TARGET count is odd (structurally unbalanced).
    tgt_dq = _count_double_quotes(target)
    if tgt_dq % 2 != 0:
        violations.append(Violation(
            segment_id=seg_id,
            file_name=file_name,
            violation_type="unpaired_symbol",
            source_term='double quotes (any style)',
            target_term=None,
            description=f"Odd number of double-quote characters in target ({tgt_dq}) — likely unpaired",
            source_text=source,
            target_text=target,
            check_source="number",
        ))

    tgt_sq = _count_single_quotes(target)
    if tgt_sq % 2 != 0:
        violations.append(Violation(
            segment_id=seg_id,
            file_name=file_name,
            violation_type="unpaired_symbol",
            source_term="single quotes (any style)",
            target_term=None,
            description=f"Odd number of single-quote characters in target ({tgt_sq}) — likely unpaired",
            source_text=source,
            target_text=target,
            check_source="number",
        ))

    return violations


# ─── Main checker ─────────────────────────────────────────────────────────────

def check_numbers(segments, skip_locked: bool = True, skip_100_match: bool = True) -> List[Violation]:
    """
    Check all segments for number/placeholder/tag mismatches.
    Returns a list of Violation objects (reuses the Violation dataclass
    from term_checker for UI compatibility).
    """
    violations: List[Violation] = []

    for seg in segments:
        source = seg.source_plain
        target = seg.target_plain

        if not target or not source:
            continue
        if skip_locked and seg.is_locked:
            continue
        if skip_100_match and (getattr(seg, 'match_percent', None) or 0) >= 100:
            continue

        # ── Number check ──────────────────────────────────────────────
        src_numbers = _extract_numbers(source)
        tgt_numbers = _extract_numbers(target)

        src_normalized = sorted(_normalize_number(n) for n in src_numbers)
        tgt_normalized = sorted(_normalize_number(n) for n in tgt_numbers)

        if src_normalized != tgt_normalized:
            # Find which numbers are missing/extra
            src_set = src_normalized.copy()
            tgt_set = tgt_normalized.copy()
            missing = []
            extra = []

            for n in src_normalized:
                if n in tgt_set:
                    tgt_set.remove(n)
                else:
                    missing.append(n)
            for n in tgt_normalized:
                if n in src_set:
                    src_set.remove(n)
                else:
                    extra.append(n)

            parts = []
            if missing:
                parts.append(f"missing in target: {', '.join(missing)}")
            if extra:
                parts.append(f"extra in target: {', '.join(extra)}")
            description = "Number mismatch — " + "; ".join(parts)

            violations.append(
                Violation(
                    segment_id=seg.id,
                    file_name=seg.file_name,
                    violation_type="number_mismatch",
                    source_term=", ".join(src_numbers) if src_numbers else "(none)",
                    target_term=", ".join(tgt_numbers) if tgt_numbers else "(none)",
                    description=description,
                    source_text=source,
                    target_text=target,
                    check_source="number",
                    match_percent=getattr(seg, 'match_percent', None),
                )
            )

        # ── Placeholder check ─────────────────────────────────────────
        src_ph = _extract_placeholders(source)
        tgt_ph = _extract_placeholders(target)

        missing_ph = src_ph - tgt_ph
        extra_ph = tgt_ph - src_ph

        if missing_ph or extra_ph:
            parts = []
            if missing_ph:
                parts.append(f"missing in target: {', '.join(sorted(missing_ph))}")
            if extra_ph:
                parts.append(f"extra in target: {', '.join(sorted(extra_ph))}")
            description = "Placeholder mismatch — " + "; ".join(parts)

            violations.append(
                Violation(
                    segment_id=seg.id,
                    file_name=seg.file_name,
                    violation_type="placeholder_mismatch",
                    source_term=", ".join(sorted(src_ph)) if src_ph else "(none)",
                    target_term=", ".join(sorted(tgt_ph)) if tgt_ph else "(none)",
                    description=description,
                    source_text=source,
                    target_text=target,
                    check_source="number",
                    match_percent=getattr(seg, 'match_percent', None),
                )
            )

        # ── Unpaired symbol check ──────────────────────────────────────
        violations.extend(
            _check_unpaired_symbols(seg.id, seg.file_name, source, target,
                                    match_percent=getattr(seg, 'match_percent', None))
        )

    return violations
