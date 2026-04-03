"""
Regex processor for XLIFF files.
Handles regex find & replace operations while preserving XML tags and structure.
"""

import re
import regex  # More powerful regex library with better Unicode support
from typing import List, Dict, Tuple, Optional, Callable
from dataclasses import dataclass
from lxml import etree


@dataclass
class Match:
    """Represents a regex match in a translation unit."""
    trans_unit_id: str
    segment_type: str  # 'source' or 'target'
    matched_text: str
    start_pos: int
    end_pos: int
    full_text: str


@dataclass
class ReplaceResult:
    """Result of a replace operation."""
    trans_unit_id: str
    original_text: str
    new_text: str
    matches_count: int


class RegexProcessor:
    """
    Handles regex operations on XLIFF content with tag preservation.
    """

    def __init__(self, use_advanced_regex: bool = True):
        """
        Initialize regex processor.

        Args:
            use_advanced_regex: Use 'regex' library instead of 're' for better Unicode support
        """
        self.regex_module = regex if use_advanced_regex else re
        self.matches: List[Match] = []

    def find_in_text(self,
                     text: str,
                     pattern: str,
                     flags: int = 0,
                     ignore_tags: bool = True,
                     exclude_pattern: str = None) -> List[Tuple[int, int, str]]:
        """
        Find all matches of pattern in text.

        Args:
            text: Text to search in
            pattern: Regex pattern
            flags: Regex flags (e.g., re.IGNORECASE)
            ignore_tags: If True, don't match inside XML tags
            exclude_pattern: Optional pattern to exclude from matches

        Returns:
            List of (start, end, matched_text) tuples
        """
        try:
            if ignore_tags:
                # Extract text segments without tags for matching
                text_segments, tag_positions = self._extract_text_segments(text)
                plain_text = ''.join(text_segments)

                # Find matches in plain text
                matches = []
                for match in self.regex_module.finditer(pattern, plain_text, flags):
                    matched_text = match.group(0)

                    # Check if this match should be excluded
                    if exclude_pattern and self.regex_module.match(exclude_pattern, matched_text, flags):
                        continue

                    # Map back to original position
                    original_start = self._map_to_original_position(
                        match.start(), text_segments, tag_positions)
                    original_end = self._map_to_original_position(
                        match.end(), text_segments, tag_positions)

                    matches.append((original_start, original_end, matched_text))

                return matches
            else:
                # Simple search in full text (including tags)
                matches = []
                for m in self.regex_module.finditer(pattern, text, flags):
                    matched_text = m.group(0)

                    # Check if this match should be excluded
                    if exclude_pattern and self.regex_module.match(exclude_pattern, matched_text, flags):
                        continue

                    matches.append((m.start(), m.end(), matched_text))

                return matches

        except Exception as e:
            print(f"Regex error: {e}")
            return []

    def replace_in_text(self,
                       text: str,
                       pattern: str,
                       replacement: str,
                       flags: int = 0,
                       ignore_tags: bool = True,
                       max_replacements: int = 0,
                       exclude_pattern: str = None) -> Tuple[str, int]:
        """
        Replace matches in text while preserving XML tags.

        Args:
            text: Text to process
            pattern: Regex pattern
            replacement: Replacement string (supports backreferences like \\1, \\2 or $1, $2)
            flags: Regex flags
            ignore_tags: If True, only replace in text content, not in tags
            max_replacements: Maximum number of replacements (0 = unlimited)
            exclude_pattern: Optional pattern to exclude from replacement

        Returns:
            Tuple of (new_text, replacement_count)
        """
        try:
            # Convert JavaScript-style backreferences ($1, $2) to Python-style (\1, \2)
            # This ensures compatibility with regex library patterns created in the GUI
            replacement = re.sub(r'\$(\d+)', r'\\\1', replacement)
            if not ignore_tags:
                # Simple replacement in full text
                if max_replacements > 0:
                    new_text = self.regex_module.sub(
                        pattern, replacement, text, count=max_replacements, flags=flags)
                else:
                    new_text = self.regex_module.sub(
                        pattern, replacement, text, flags=flags)

                count = len(self.regex_module.findall(pattern, text, flags=flags))
                return new_text, min(count, max_replacements) if max_replacements > 0 else count

            # Complex case: preserve tags
            text_segments, tag_positions = self._extract_text_segments(text)

            # Process each text segment
            replacements_made = 0
            for i, segment in enumerate(text_segments):
                if max_replacements > 0 and replacements_made >= max_replacements:
                    break

                # If exclude pattern is specified, use custom replacement function
                if exclude_pattern:
                    new_segment, replacements = self._replace_with_exclude(
                        segment, pattern, replacement, exclude_pattern, flags,
                        max_replacements - replacements_made if max_replacements > 0 else 0
                    )
                else:
                    remaining = max_replacements - replacements_made if max_replacements > 0 else 0
                    count_limit = remaining if remaining > 0 else 0

                    if count_limit > 0:
                        new_segment = self.regex_module.sub(
                            pattern, replacement, segment, count=count_limit, flags=flags)
                        replacements = count_limit
                    else:
                        new_segment = self.regex_module.sub(
                            pattern, replacement, segment, flags=flags)
                        replacements = len(self.regex_module.findall(pattern, segment, flags=flags))

                text_segments[i] = new_segment
                replacements_made += replacements

            # Reconstruct text with tags
            new_text = self._reconstruct_text(text_segments, tag_positions, text)

            return new_text, replacements_made

        except Exception as e:
            print(f"Regex replacement error: {e}")
            return text, 0

    def _replace_with_exclude(self,
                             text: str,
                             pattern: str,
                             replacement: str,
                             exclude_pattern: str,
                             flags: int = 0,
                             max_count: int = 0) -> Tuple[str, int]:
        """
        Replace matches while excluding certain patterns.

        Args:
            text: Text to process
            pattern: Pattern to find
            replacement: Replacement string
            exclude_pattern: Pattern to exclude
            flags: Regex flags
            max_count: Maximum replacements

        Returns:
            Tuple of (new_text, count)
        """
        result_parts = []
        last_end = 0
        replacements = 0

        for match in self.regex_module.finditer(pattern, text, flags):
            matched_text = match.group(0)

            # Check if this match should be excluded
            if self.regex_module.match(exclude_pattern, matched_text, flags):
                # Keep the original match
                result_parts.append(text[last_end:match.end()])
            else:
                # Do replacement
                if max_count == 0 or replacements < max_count:
                    result_parts.append(text[last_end:match.start()])
                    result_parts.append(self.regex_module.sub(pattern, replacement, matched_text, flags=flags))
                    replacements += 1
                else:
                    result_parts.append(text[last_end:match.end()])

            last_end = match.end()

        # Add remaining text
        result_parts.append(text[last_end:])

        return ''.join(result_parts), replacements

    def _extract_text_segments(self, text: str) -> Tuple[List[str], List[Tuple[int, int, str]]]:
        """
        Extract text segments and tag positions from XML text.

        Handles both regular XML tags (<tag>) and escaped HTML entities (&lt;tag&gt;).

        Returns:
            Tuple of (text_segments, tag_positions)
            where tag_positions is list of (start, end, tag_content)
        """
        text_segments = []
        tag_positions = []

        current_pos = 0
        # Match XML tags at various escaping levels:
        # 1. Regular tags: <tag attr="value">
        # 2. Single-escaped: &lt;tag attr="value"&gt;
        # 3. Double-escaped: &amp;lt;tag attr="value"&amp;gt;
        # We allow HTML entities (&...;) inside tags since they're part of the tag structure
        tag_pattern = r'(?:<[^<>]*>|&lt;(?:[^&]|&[a-zA-Z]+;|&#\d+;)*?&gt;|&amp;lt;(?:[^&]|&(?:amp|quot|lt|gt|#\d+);)*?&amp;gt;)'

        for match in re.finditer(tag_pattern, text):
            # Text before tag
            if match.start() > current_pos:
                text_segments.append(text[current_pos:match.start()])

            # Store tag position
            tag_positions.append((match.start(), match.end(), match.group(0)))

            current_pos = match.end()

        # Remaining text after last tag
        if current_pos < len(text):
            text_segments.append(text[current_pos:])

        return text_segments, tag_positions

    def _map_to_original_position(self,
                                  plain_pos: int,
                                  text_segments: List[str],
                                  tag_positions: List[Tuple[int, int, str]]) -> int:
        """
        Map position in plain text (without tags) back to original position (with tags).
        """
        char_count = 0
        original_pos = 0

        for i, segment in enumerate(text_segments):
            if char_count + len(segment) >= plain_pos:
                # Position is in this segment
                offset = plain_pos - char_count
                return original_pos + offset

            char_count += len(segment)
            original_pos += len(segment)

            # Add tag length if there's a tag after this segment
            if i < len(tag_positions):
                tag_start, tag_end, tag_content = tag_positions[i]
                original_pos += len(tag_content)

        return original_pos

    def _reconstruct_text(self,
                         text_segments: List[str],
                         tag_positions: List[Tuple[int, int, str]],
                         original_text: str) -> str:
        """
        Reconstruct text by interleaving text segments and tags.
        """
        result = []

        for i, segment in enumerate(text_segments):
            result.append(segment)

            # Add tag after segment if exists
            if i < len(tag_positions):
                _, _, tag_content = tag_positions[i]
                result.append(tag_content)

        return ''.join(result)

    def validate_pattern(self, pattern: str) -> Tuple[bool, str]:
        """
        Validate regex pattern.

        Returns:
            Tuple of (is_valid, error_message)
        """
        try:
            self.regex_module.compile(pattern)
            return True, ""
        except Exception as e:
            return False, str(e)

    def test_replacement(self, test_text: str, pattern: str, replacement: str) -> Optional[str]:
        """
        Test a replacement on sample text without modifying actual files.
        Useful for previewing regex operations.
        """
        try:
            result, count = self.replace_in_text(test_text, pattern, replacement)
            return result
        except Exception as e:
            print(f"Test replacement error: {e}")
            return None
