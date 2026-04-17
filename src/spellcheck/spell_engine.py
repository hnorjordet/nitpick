"""
Spell engine for SpellcheckQA.
Wraps spylls (pure-Python Hunspell) and applies filtering rules.
"""

import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Set, Optional

from spylls.hunspell import Dictionary

# Max time for a single spylls lookup before we assume the word is unknown
_LOOKUP_TIMEOUT_S = 0.5


@dataclass
class FlaggedWord:
    word: str
    count: int = 0
    segment_ids: List[str] = field(default_factory=list)


# Always-active filters
_DIGIT_RE = re.compile(r"\d")

# Common international loanwords / tech acronyms that appear in Norwegian text
# and are unlikely to be in any Hunspell dictionary
_ALWAYS_SKIP: Set[str] = {
    # File formats and protocols
    "pdf", "xml", "html", "css", "json", "csv", "jpg", "jpeg", "png", "gif",
    "svg", "mp3", "mp4", "wav", "zip", "tar", "gz", "exe", "dll",
    "url", "uri", "http", "https", "ftp", "ssh", "ssl", "tls", "smtp", "imap",
    # Tech / UI terms widely used in Norwegian text
    "api", "gui", "cli", "sdk", "ide", "app", "apps",
    "pc", "usb", "ram", "cpu", "gpu", "ssd", "hdd",
    "wifi", "lan", "wan", "vpn", "ip", "dns", "dhcp",
    # Common English loanwords used untranslated in Norwegian
    "login", "logout", "online", "offline", "email", "spam", "chat",
    "download", "upload", "backup", "server", "cloud",
    # Norwegian compound forms that are commonly missing from ordbank
    "utlogging", "innlogging", "pålogging",
}


def _should_skip(word: str, source_words: Set[str], exclusion_set: Set[str]) -> bool:
    """Return True if word should be silently skipped."""
    # Single characters
    if len(word) <= 1:
        return True
    # Words with digits (CO2, IPv4, etc.)
    if _DIGIT_RE.search(word):
        return True
    # Abbreviations ending with period
    if word.endswith("."):
        return True
    # ALL-UPPERCASE words — acronyms/abbreviations, never real Norwegian words
    if word.isupper():
        return True
    # Words containing underscores — form-fill lines, placeholders, identifiers
    if "_" in word:
        return True
    # Extremely long tokens (>40 chars) — never valid Norwegian words, avoid exponential compound search
    if len(word) > 40:
        return True
    # Lowercase version of any uppercase source word (e.g. source has PDF, target has pdf)
    if word.lower() in {w.lower() for w in source_words if w.isupper()}:
        return True
    # Common international loanwords / tech terms always skipped
    if word.lower() in _ALWAYS_SKIP:
        return True
    # In exclusion set (terms, glossary, etc.) – case-insensitive
    if word.lower() in exclusion_set:
        return True
    return False


def load_dictionary(dic_paths: List[str]) -> Optional[Dictionary]:
    """
    Load Hunspell dictionary from a .dic file.
    If a matching .aff file exists alongside the .dic, it is used for full
    affix/inflection expansion (flagged Hunspell format).
    If no .aff exists, a minimal stub .aff is written to a temp file so that
    spylls can load the .dic as a flat word list (every line = one accepted form).
    """
    if not dic_paths:
        return None

    primary = dic_paths[0]
    dic_file = Path(primary)
    aff_file = dic_file.with_suffix(".aff")

    if not dic_file.exists():
        print(f"Dictionary not found: {dic_file}", file=sys.stderr)
        return None

    # If no .aff exists, create a minimal stub so spylls can load the flat word list
    _stub_aff: Optional[Path] = None
    if not aff_file.exists():
        import tempfile, shutil
        tmp_dir = Path(tempfile.mkdtemp(prefix="spellcheck_qa_"))
        stub_dic = tmp_dir / dic_file.name
        stub_aff = tmp_dir / aff_file.name
        shutil.copy2(dic_file, stub_dic)
        # Minimal Hunspell .aff: UTF-8, no affix rules → every entry accepted as-is
        stub_aff.write_text("SET UTF-8\n", encoding="utf-8")
        _stub_aff = tmp_dir
        aff_file = stub_aff
        dic_file = stub_dic
        print(f"No .aff for {primary!r} — loading as flat word list.", file=sys.stderr)

    try:
        result = Dictionary.from_files(str(dic_file.with_suffix("")))
    except Exception as e:
        print(f"Failed to load dictionary {primary}: {e}", file=sys.stderr)
        result = None
    finally:
        # Clean up temporary stub directory if we created one
        if _stub_aff is not None:
            import shutil as _shutil
            _shutil.rmtree(_stub_aff, ignore_errors=True)

    return result


def load_all_dictionaries(dic_paths: List[str]) -> List[Optional[Dictionary]]:
    """Load all dictionaries; used for unioning spell results across multiple dics."""
    dicts = []
    for path in dic_paths:
        d = load_dictionary([path])
        if d is not None:
            dicts.append(d)
    return dicts


def build_exclusion_set(file_paths: List[str]) -> Set[str]:
    """
    Build a case-insensitive exclusion word set from termlist and checklist files.
    Words in this set are skipped during spellcheck without Hunspell lookup.
    Supported formats: CSV (one or two columns), plain text (one word per line).
    """
    exclusion: Set[str] = set()
    for path in file_paths:
        p = Path(path)
        if not p.exists():
            continue
        try:
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    # CSV: take both columns
                    parts = [c.strip().strip('"') for c in line.split(",") if c.strip()]
                    for word in parts:
                        # Add each token of multi-word terms
                        for token in word.split():
                            exclusion.add(token.lower())
        except Exception as e:
            print(f"Warning: failed to read exclusion file {path}: {e}", file=sys.stderr)
    return exclusion


def tokenize(text: str) -> List[str]:
    """Split text into words, preserving hyphenated compounds as separate tokens."""
    # Strip invisible Unicode characters that CAT tools may embed (soft hyphen,
    # zero-width space/joiner/non-joiner, BOM, etc.) before tokenizing
    text = re.sub(r"[\xad\u200b\u200c\u200d\ufeff\u00a0]", "", text)
    # Split on whitespace and punctuation except hyphens and apostrophes within words
    raw = re.findall(r"[^\s\W]+(?:[-'][^\s\W]+)*", text, re.UNICODE)
    return raw


def _compound_lookup(word: str, dictionaries: List[Dictionary]) -> bool:
    """
    Norwegian compound-word heuristic.
    Tries split points where each part is at least MIN_PART characters.
    Returns True if the word can be fully decomposed into known dictionary words.
    Both parts are checked recursively so triple compounds are also caught.

    Only activated for words ≥ 10 characters to avoid false positives on short words.
    Uses an internal memoize cache to avoid redundant sub-lookups across recursive calls.

    MIN_PART = 4 is deliberately conservative: Norwegian compound stems are typically
    4+ characters (e.g. "hus", "bil" are exceptions, but "tje", "ste", "vai" are
    not meaningful compound stems). This prevents the engine from accepting
    "Tjenestekvaitetnivået" via spurious splits like tjene|ste|kvai|tet|nivå.
    """
    # Minimum characters per compound part — raising from 3 to 4 eliminates most
    # spurious 3-letter matches (ste, vai, tet, etc.) while still catching real
    # compounds like hus+eier, bil+park, etc.
    MIN_PART = 4

    if len(word) < MIN_PART * 2:
        return False

    # Memoize cache shared across all recursive calls for this top-level word
    _known_cache: dict = {}

    def is_known(w: str) -> bool:
        """Single direct lookup with genitive-s fallback; memoized."""
        key = w.lower()
        if key in _known_cache:
            return _known_cache[key]
        result = any(d.lookup(w) for d in dictionaries)
        if not result and key.endswith("s") and len(w) > MIN_PART:
            result = any(d.lookup(w[:-1]) for d in dictionaries)
        _known_cache[key] = result
        return result

    def check(w: str, depth: int = 0) -> bool:
        if depth > 2:  # max 3 parts (triple compound)
            return False
        # Each part must be at least MIN_PART characters
        for split in range(MIN_PART, len(w) - MIN_PART + 1):
            left = w[:split]
            right = w[split:]
            left_ok = is_known(left) or (len(left) >= MIN_PART * 2 and check(left, depth + 1))
            right_ok = is_known(right) or (len(right) >= MIN_PART * 2 and check(right, depth + 1))
            if left_ok and right_ok:
                return True
        return False

    return check(word.lower())


def run_spellcheck(
    segments,
    dictionaries: List[Dictionary],
    exclusion_set: Set[str],
    skip_locked: bool = True,
    compound_check: bool = True,
    skip_100_match: bool = True,
) -> List[FlaggedWord]:
    """
    Run spellcheck over a list of Segment objects.

    skip_locked: skip segments marked as locked/read-only in the XLIFF.
    compound_check: accept words whose parts are all valid dictionary words
                    (Norwegian compound-word heuristic).
    skip_100_match: skip segments with a TM match percentage of 100 or above.

    Returns flagged words sorted by occurrence count (descending).
    """
    if not dictionaries:
        return []

    # Cache: word_lower → True (accepted) | False (rejected)
    lookup_cache: dict = {}

    def single_lookup(word: str) -> bool:
        """Lookup a single non-hyphenated word against all dictionaries."""
        accepted = any(d.lookup(word) for d in dictionaries)
        # Norwegian genitive -s: "medlemmenes" → check "medlemmene"
        if not accepted and word.lower().endswith("s") and len(word) > 3:
            accepted = any(d.lookup(word[:-1]) for d in dictionaries)
        return accepted

    def cached_lookup(word: str) -> bool:
        key = word.lower()
        if key in lookup_cache:
            return lookup_cache[key]

        # Hyphenated words: check each part independently
        # e.g. "UTS-instrumentet" → skip "UTS" (all-uppercase), check "instrumentet"
        if "-" in word:
            parts = word.split("-")
            accepted = all(
                _should_skip(p, set(), exclusion_set)  # skip acronyms etc.
                or single_lookup(p)
                for p in parts if p
            )
        else:
            accepted = single_lookup(word)
            # Compound heuristic: if the direct lookup failed, try binary splits
            if not accepted and compound_check:
                accepted = _compound_lookup(word, dictionaries)

        lookup_cache[key] = accepted
        return accepted

    # word → FlaggedWord
    flagged: dict = {}

    for seg in segments:
        if not seg.target_plain:
            continue
        # Skip locked/read-only segments if requested
        if skip_locked and seg.is_locked:
            continue
        # Skip 100% TM matches if requested
        if skip_100_match and (seg.match_percent or 0) >= 100:
            continue

        source_words: Set[str] = set(tokenize(seg.source_plain))
        words = tokenize(seg.target_plain)

        for word in words:
            if _should_skip(word, source_words, exclusion_set):
                continue

            accepted = cached_lookup(word)
            if not accepted:
                w = word.lower()
                if w not in flagged:
                    flagged[w] = FlaggedWord(word=word, count=0, segment_ids=[])
                flagged[w].count += 1
                if seg.id not in flagged[w].segment_ids:
                    flagged[w].segment_ids.append(seg.id)

    return sorted(flagged.values(), key=lambda fw: fw.count, reverse=True)


def get_suggestions(word: str, dictionaries: List[Dictionary], max_suggestions: int = 8) -> List[str]:
    """
    Get spelling suggestions for a word from all loaded dictionaries.
    Results from multiple dics are unioned and deduplicated.
    """
    seen: Set[str] = set()
    result: List[str] = []
    for d in dictionaries:
        for suggestion in d.suggest(word):
            if suggestion.lower() not in seen:
                seen.add(suggestion.lower())
                result.append(suggestion)
            if len(result) >= max_suggestions:
                return result
    return result
