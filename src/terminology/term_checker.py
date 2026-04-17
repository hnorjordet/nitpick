"""
Terminology and checklist checker for SpellcheckQA.
Checks segments against termlists (CSV/TBX) and Xbench checklists.
"""

import re
import sys
from dataclasses import dataclass
from typing import List, Optional

from parsers.termlist_parser import TermEntry, CheckRule


@dataclass
class Violation:
    segment_id: str
    file_name: str
    violation_type: str    # "dnt_translated" | "missing_required" | "forbidden_found" | "rule_violation"
    source_term: str
    target_term: Optional[str]
    description: str
    source_text: str       # full source segment for context
    target_text: str       # full target segment for context
    check_source: str = "termlist"  # "termlist" | "checklist" | "number" | "qa"


# Normalise all quote variants to a canonical form before matching,
# so that 'word', "word", «word», "word" etc. all compare equal.
_QUOTE_NORM = str.maketrans({
    '\u201c': '"', '\u201d': '"', '\u201e': '"',  # " " „  → "
    '\u00ab': '"', '\u00bb': '"',                  # « »    → "
    '\u2018': "'", '\u2019': "'",                  # ' '    → '
    '\u2039': "'", '\u203a': "'",                  # ‹ ›    → '
})


def _normalize_quotes(text: str) -> str:
    return text.translate(_QUOTE_NORM)


def _contains(text: str, term: str, case_sensitive: bool = False) -> bool:
    """Check if term appears as a whole word or phrase in text.

    Quote characters are normalised before comparison so that
    'word', "word", «word» etc. are treated as equivalent.
    """
    flags = 0 if case_sensitive else re.IGNORECASE
    pattern = r"(?<!\w)" + re.escape(_normalize_quotes(term)) + r"(?!\w)"
    return bool(re.search(pattern, _normalize_quotes(text), flags))


def check_segments(
    segments,
    term_entries: List[TermEntry],
    check_rules: List[CheckRule],
    skip_locked: bool = True,
    skip_100_match: bool = True,
) -> List[Violation]:
    """
    Check all segments against term entries and checklist rules.
    Returns a list of Violation objects.
    """
    violations: List[Violation] = []

    for seg in segments:
        source = seg.source_plain
        target = seg.target_plain

        if not target:
            continue
        if skip_locked and getattr(seg, 'is_locked', False):
            continue
        if skip_100_match and (getattr(seg, 'match_percent', None) or 0) >= 100:
            continue

        # ── Termlist checks ───────────────────────────────────────────────
        for entry in term_entries:
            if entry.entry_type == "dnt":
                # DNT: source term should NOT be translated (target should keep source term)
                if _contains(source, entry.source):
                    # Flag if the source term is NOT present in target (i.e. it was "translated away")
                    if not _contains(target, entry.source):
                        violations.append(
                            Violation(
                                segment_id=seg.id,
                                file_name=seg.file_name,
                                violation_type="dnt_translated",
                                source_term=entry.source,
                                target_term=None,
                                description=f"DNT term '{entry.source}' appears to have been translated",
                                source_text=source,
                                target_text=target,
                                check_source="termlist",
                            )
                        )

            elif entry.entry_type == "required":
                # Required: if source term is present, target term must also be present
                if entry.target and _contains(source, entry.source):
                    if not _contains(target, entry.target):
                        violations.append(
                            Violation(
                                segment_id=seg.id,
                                file_name=seg.file_name,
                                violation_type="missing_required",
                                source_term=entry.source,
                                target_term=entry.target,
                                description=f"Required translation '{entry.target}' missing for '{entry.source}'",
                                source_text=source,
                                target_text=target,
                                check_source="termlist",
                            )
                        )

            elif entry.entry_type == "forbidden":
                # Forbidden: target must NOT contain this term
                if _contains(target, entry.source):
                    violations.append(
                        Violation(
                            segment_id=seg.id,
                            file_name=seg.file_name,
                            violation_type="forbidden_found",
                            source_term=entry.source,
                            target_term=None,
                            description=f"Forbidden term '{entry.source}' found in target",
                            source_text=source,
                            target_text=target,
                            check_source="termlist",
                        )
                    )

        # ── Checklist rule checks ─────────────────────────────────────────
        for rule in check_rules:
            flags = 0 if rule.case_sensitive else re.IGNORECASE

            # For simple (non-regex) patterns use word-boundary matching via _contains().
            # For regex patterns fall back to re.search() so intentional regex still works.
            def _rule_match(pattern: str, text: str) -> bool:
                if rule.is_regex:
                    return bool(re.search(pattern, text, flags))
                return _contains(text, pattern, case_sensitive=rule.case_sensitive)

            if rule.check_type == "source_not_in_target":
                # DNT-style: if source contains term, it must also appear in target
                if _rule_match(rule.pattern, source):
                    if not _rule_match(rule.pattern, target):
                        violations.append(
                            Violation(
                                segment_id=seg.id,
                                file_name=seg.file_name,
                                violation_type="rule_violation",
                                source_term=rule.pattern,
                                target_term=None,
                                description=rule.description or f"Term '{rule.pattern}' found in source but not in target",
                                source_text=source,
                                target_text=target,
                                check_source="checklist",
                            )
                        )

            elif rule.check_type == "forbidden_in_target":
                if rule.target_pattern and _rule_match(rule.target_pattern, target):
                    violations.append(
                        Violation(
                            segment_id=seg.id,
                            file_name=seg.file_name,
                            violation_type="rule_violation",
                            source_term=rule.target_pattern,
                            target_term=None,
                            description=rule.description or f"Forbidden term '{rule.target_pattern}' found in target",
                            source_text=source,
                            target_text=target,
                            check_source="checklist",
                        )
                    )

            elif rule.check_type == "pattern_match":
                # If source matches rule.pattern, target must match rule.target_pattern
                if rule.target_pattern and _rule_match(rule.pattern, source):
                    if not _rule_match(rule.target_pattern, target):
                        violations.append(
                            Violation(
                                segment_id=seg.id,
                                file_name=seg.file_name,
                                violation_type="rule_violation",
                                source_term=rule.pattern,
                                target_term=rule.target_pattern,
                                description=rule.description or f"Target does not match expected pattern '{rule.target_pattern}'",
                                source_text=source,
                                target_text=target,
                                check_source="checklist",
                            )
                        )

    return violations
