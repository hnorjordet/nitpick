"""
Pattern Library for common regex patterns used in translation/localization.
Inspired by common QA checks in CAT tools like Xbench, Verifika, and ApSIC.
"""

import json
from pathlib import Path
from typing import List, Dict, Optional
from dataclasses import dataclass, asdict


@dataclass
class Pattern:
    """Represents a regex pattern with metadata."""
    name: str
    pattern: str
    replacement: str = ""
    description: str = ""
    category: str = "General"
    case_sensitive: bool = False
    enabled: bool = True
    tags: List[str] = None

    def __post_init__(self):
        if self.tags is None:
            self.tags = []

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> 'Pattern':
        return cls(**data)


class PatternLibrary:
    """
    Manages a library of regex patterns.
    Can load/save patterns and provides built-in patterns for common issues.
    """

    def __init__(self, library_path: Optional[str] = None):
        """
        Initialize pattern library.

        Args:
            library_path: Path to JSON file for custom patterns.
                         If None, uses default location.
        """
        if library_path:
            self.library_path = Path(library_path)
        else:
            # Default: .patterns/library.json in project root
            self.library_path = Path.home() / '.xliff_regex_tool' / 'patterns.json'

        self.patterns: List[Pattern] = []
        self._load_builtin_patterns()

    def _load_builtin_patterns(self):
        """Load built-in patterns for common translation issues."""

        # Category: Whitespace issues
        self.patterns.extend([
            Pattern(
                name="Multiple spaces",
                pattern=r"\s{2,}",
                replacement=" ",
                description="Find and normalize multiple consecutive spaces to single space",
                category="Whitespace",
                tags=["whitespace", "formatting", "common"]
            ),
            Pattern(
                name="Leading spaces",
                pattern=r"^\s+",
                replacement="",
                description="Remove spaces at the beginning of segment",
                category="Whitespace",
                tags=["whitespace", "formatting"]
            ),
            Pattern(
                name="Trailing spaces",
                pattern=r"\s+$",
                replacement="",
                description="Remove spaces at the end of segment",
                category="Whitespace",
                tags=["whitespace", "formatting"]
            ),
            Pattern(
                name="Space before punctuation",
                pattern=r"\s+([.,!?;:])",
                replacement=r"\1",
                description="Remove space before punctuation marks",
                category="Whitespace",
                tags=["whitespace", "punctuation"]
            ),
            Pattern(
                name="No space after punctuation",
                pattern=r"([.,!?;:])([A-ZÆØÅ])",
                replacement=r"\1 \2",
                description="Add space after punctuation before capital letter",
                category="Whitespace",
                tags=["whitespace", "punctuation"]
            ),
        ])

        # Category: Punctuation issues
        self.patterns.extend([
            Pattern(
                name="Double periods",
                pattern=r"\.\.",
                replacement=".",
                description="Replace double periods with single period",
                category="Punctuation",
                tags=["punctuation", "typo"]
            ),
            Pattern(
                name="Double commas",
                pattern=r",,",
                replacement=",",
                description="Replace double commas with single comma",
                category="Punctuation",
                tags=["punctuation", "typo"]
            ),
            Pattern(
                name="Space before comma",
                pattern=r"\s+,",
                replacement=",",
                description="Remove space before comma",
                category="Punctuation",
                tags=["punctuation", "formatting"]
            ),
        ])

        # Category: Norwegian specific
        self.patterns.extend([
            Pattern(
                name="Norwegian quotes (English style)",
                pattern=r'"([^"]+)"',
                replacement=r'«\1»',
                description="Convert English quotes to Norwegian guillemets",
                category="Norwegian",
                tags=["norwegian", "quotes", "localization"],
                enabled=False  # Disabled by default
            ),
            Pattern(
                name="Date format US to NO",
                pattern=r"(\d{1,2})/(\d{1,2})/(\d{4})",
                replacement=r"\2.\1.\3",
                description="Convert MM/DD/YYYY to DD.MM.YYYY",
                category="Norwegian",
                tags=["norwegian", "date", "localization"],
                enabled=False
            ),
        ])

        # Category: Common typos (English)
        self.patterns.extend([
            Pattern(
                name="'teh' typo",
                pattern=r"\bteh\b",
                replacement="the",
                description="Fix common 'teh' -> 'the' typo",
                category="Typos",
                tags=["typo", "english"]
            ),
            Pattern(
                name="'recieve' typo",
                pattern=r"\brecieve\b",
                replacement="receive",
                description="Fix common 'recieve' -> 'receive' typo",
                category="Typos",
                tags=["typo", "english"]
            ),
            Pattern(
                name="'occured' typo",
                pattern=r"\boccured\b",
                replacement="occurred",
                description="Fix common 'occured' -> 'occurred' typo",
                category="Typos",
                tags=["typo", "english"]
            ),
        ])

        # Category: Numbers and measurements
        self.patterns.extend([
            Pattern(
                name="Space in large numbers",
                pattern=r"(\d)(\d{3})\b",
                replacement=r"\1 \2",
                description="Add space as thousand separator (Norwegian standard)",
                category="Numbers",
                tags=["numbers", "norwegian", "formatting"],
                enabled=False
            ),
            Pattern(
                name="Comma to period in decimals",
                pattern=r"(\d),(\d)",
                replacement=r"\1.\2",
                description="Convert comma decimal separator to period",
                category="Numbers",
                tags=["numbers", "localization"],
                enabled=False
            ),
        ])

        # Category: URLs and emails
        self.patterns.extend([
            Pattern(
                name="Find email addresses",
                pattern=r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b",
                replacement="",
                description="Find all email addresses",
                category="URLs & Emails",
                tags=["email", "search-only"]
            ),
            Pattern(
                name="Find HTTP URLs",
                pattern=r"https?://[^\s<>\"]+",
                replacement="",
                description="Find all HTTP/HTTPS URLs",
                category="URLs & Emails",
                tags=["url", "search-only"]
            ),
        ])

        # Category: Tags and markup (common issues)
        self.patterns.extend([
            Pattern(
                name="Unmatched brackets",
                pattern=r"\[[^\]]*$|^[^\[]*\]",
                replacement="",
                description="Find segments with unmatched square brackets",
                category="Tags & Markup",
                tags=["tags", "qa", "search-only"]
            ),
            Pattern(
                name="Unmatched parentheses",
                pattern=r"\([^\)]*$|^[^\(]*\)",
                replacement="",
                description="Find segments with unmatched parentheses",
                category="Tags & Markup",
                tags=["tags", "qa", "search-only"]
            ),
        ])

        # Category: Consistency checks
        self.patterns.extend([
            Pattern(
                name="Inconsistent capitalization of 'internet'",
                pattern=r"\binternet\b",
                replacement="Internet",
                description="Capitalize 'Internet' (if style guide requires)",
                category="Consistency",
                tags=["consistency", "capitalization"],
                enabled=False
            ),
            Pattern(
                name="Inconsistent capitalization of 'e-mail'",
                pattern=r"\bemail\b",
                replacement="e-mail",
                description="Change 'email' to 'e-mail' for consistency",
                category="Consistency",
                tags=["consistency", "norwegian"],
                enabled=False
            ),
        ])

        # Category: Norwegian specific typos
        self.patterns.extend([
            Pattern(
                name="'å' vs 'aa'",
                pattern=r"\baa\b",
                replacement="å",
                description="Replace 'aa' with 'å' in Norwegian text",
                category="Norwegian",
                tags=["norwegian", "typo"],
                enabled=False
            ),
            Pattern(
                name="Norwegian double negation",
                pattern=r"\bikke\s+ingen\b",
                replacement="ingen",
                description="Fix double negation (ikke ingen -> ingen)",
                category="Norwegian",
                tags=["norwegian", "grammar"],
                enabled=False
            ),
        ])

    def load_custom_patterns(self) -> bool:
        """Load custom patterns from JSON file."""
        try:
            if not self.library_path.exists():
                return False

            with open(self.library_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            # Add custom patterns (don't overwrite built-in)
            for pattern_data in data.get('patterns', []):
                pattern = Pattern.from_dict(pattern_data)
                # Check if pattern with same name exists
                existing = self.get_pattern_by_name(pattern.name)
                if existing:
                    # Update existing
                    self.patterns.remove(existing)
                self.patterns.append(pattern)

            return True

        except Exception as e:
            print(f"Error loading custom patterns: {e}")
            return False

    def save_custom_patterns(self) -> bool:
        """Save all patterns to JSON file."""
        try:
            self.library_path.parent.mkdir(parents=True, exist_ok=True)

            data = {
                'patterns': [p.to_dict() for p in self.patterns]
            }

            with open(self.library_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

            return True

        except Exception as e:
            print(f"Error saving patterns: {e}")
            return False

    def add_pattern(self, pattern: Pattern) -> bool:
        """Add a new pattern to the library."""
        # Check for duplicate names
        if self.get_pattern_by_name(pattern.name):
            print(f"Pattern with name '{pattern.name}' already exists")
            return False

        self.patterns.append(pattern)
        return True

    def remove_pattern(self, name: str) -> bool:
        """Remove a pattern by name."""
        pattern = self.get_pattern_by_name(name)
        if pattern:
            self.patterns.remove(pattern)
            return True
        return False

    def get_pattern_by_name(self, name: str) -> Optional[Pattern]:
        """Get a pattern by name."""
        for pattern in self.patterns:
            if pattern.name == name:
                return pattern
        return None

    def get_patterns_by_category(self, category: str) -> List[Pattern]:
        """Get all patterns in a category."""
        return [p for p in self.patterns if p.category == category]

    def get_patterns_by_tag(self, tag: str) -> List[Pattern]:
        """Get all patterns with a specific tag."""
        return [p for p in self.patterns if tag in p.tags]

    def get_enabled_patterns(self) -> List[Pattern]:
        """Get all enabled patterns."""
        return [p for p in self.patterns if p.enabled]

    def search_patterns(self, query: str) -> List[Pattern]:
        """Search patterns by name, description, or tags."""
        query_lower = query.lower()
        results = []

        for pattern in self.patterns:
            if (query_lower in pattern.name.lower() or
                query_lower in pattern.description.lower() or
                any(query_lower in tag.lower() for tag in pattern.tags)):
                results.append(pattern)

        return results

    def get_categories(self) -> List[str]:
        """Get all unique categories."""
        return sorted(set(p.category for p in self.patterns))

    def get_all_tags(self) -> List[str]:
        """Get all unique tags."""
        tags = set()
        for pattern in self.patterns:
            tags.update(pattern.tags)
        return sorted(tags)

    def list_patterns(self, category: Optional[str] = None,
                     tag: Optional[str] = None,
                     enabled_only: bool = False) -> List[Pattern]:
        """
        List patterns with optional filtering.

        Args:
            category: Filter by category
            tag: Filter by tag
            enabled_only: Only show enabled patterns

        Returns:
            List of matching patterns
        """
        results = self.patterns

        if category:
            results = [p for p in results if p.category == category]

        if tag:
            results = [p for p in results if tag in p.tags]

        if enabled_only:
            results = [p for p in results if p.enabled]

        return results
