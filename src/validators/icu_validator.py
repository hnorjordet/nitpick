#!/usr/bin/env python3
"""
ICU MessageFormat Validator for XLIFF files
Validates ICU syntax in translation files from any CAT tool
"""

import re
from typing import List, Dict, Optional


class ICUValidator:
    """Validates ICU MessageFormat syntax in XLIFF files"""

    # ICU patterns
    ICU_PATTERN = re.compile(r'\{[^}]+,\s*(plural|select|selectordinal)', re.IGNORECASE)
    # Broader pattern to catch potential ICU syntax even with wrong keywords
    # Matches: {variable, word, category_keyword {
    ICU_LIKE_PATTERN = re.compile(r'\{[^}]+,\s*\w+,.*?\w+\s*\{', re.IGNORECASE)
    ICU_KEYWORDS = {'plural', 'select', 'selectordinal'}
    CATEGORY_KEYWORDS = {'zero', 'one', 'two', 'few', 'many', 'other'}

    @classmethod
    def has_icu_syntax(cls, text: str) -> bool:
        """Check if text contains ICU MessageFormat syntax or ICU-like patterns"""
        # Check for correct ICU syntax
        if cls.ICU_PATTERN.search(text):
            return True
        # Check for ICU-like patterns (might have wrong keywords)
        if cls.ICU_LIKE_PATTERN.search(text):
            return True
        return False

    @classmethod
    def validate_segment(cls, source: str, target: str) -> List[str]:
        """
        Validate ICU syntax in a single segment.
        Returns list of error messages (empty if valid).
        """
        if not target:
            return []  # Skip empty targets

        errors = []

        # Check 1: ICU keywords must be present in exact same form
        # Look for pattern like {variable, keyword where keyword should not be translated
        for keyword in cls.ICU_KEYWORDS:
            # Find all instances of {word, keyword} pattern in source
            source_pattern = r'\{[^}]+,\s*' + keyword + r'\b'
            source_matches = re.findall(source_pattern, source, re.IGNORECASE)
            target_matches = re.findall(source_pattern, target, re.IGNORECASE)

            if len(source_matches) > 0 and len(target_matches) == 0:
                errors.append(f'ICU keyword "{keyword}" is missing or incorrectly translated in target (must remain as "{keyword}")')
            elif len(source_matches) != len(target_matches):
                errors.append(f'ICU keyword "{keyword}" count mismatch (source: {len(source_matches)}, target: {len(target_matches)})')

        # Check 2: Category keywords not changed
        for category in cls.CATEGORY_KEYWORDS:
            # Only check categories that appear before { in source
            source_matches = re.findall(r'\b(' + category + r')\s*\{', source)
            target_matches = re.findall(r'\b(' + category + r')\s*\{', target)

            if len(source_matches) > 0 and len(target_matches) == 0:
                errors.append(f'Category "{category}" is missing or incorrectly translated in target (must remain as "{category}")')
            elif len(source_matches) != len(target_matches):
                errors.append(f'Category "{category}" count mismatch (source: {len(source_matches)}, target: {len(target_matches)})')

        # Check 3: Balanced braces
        source_open = source.count('{')
        source_close = source.count('}')
        target_open = target.count('{')
        target_close = target.count('}')

        if target_open != target_close:
            diff = abs(target_open - target_close)
            if target_open > target_close:
                errors.append(f'Missing {diff} closing brace(s) }} in target')
            else:
                errors.append(f'Missing {diff} opening brace(s) {{ in target')
        elif target_open != source_open or target_close != source_close:
            errors.append(f'Brace count differs from source (source: {source_open} pairs, target: {target_open} pairs)')

        # Check 4: Variable names should not change
        source_vars = re.findall(r'\{(\w+)\s*,', source)
        target_vars = re.findall(r'\{(\w+)\s*,', target)

        # Check if variable names match
        if source_vars and target_vars:
            source_var_set = set(source_vars)
            target_var_set = set(target_vars)

            changed_vars = source_var_set - target_var_set
            if changed_vars:
                errors.append(f'Variable name(s) changed: {", ".join(sorted(changed_vars))} (should not be translated)')

        # Check 5: Comma after variable name
        source_vars = re.findall(r'\{(\w+)\s*,', source)
        target_vars = re.findall(r'\{(\w+)\s*,', target)

        if len(source_vars) != len(target_vars):
            errors.append(f'Variable/comma pattern mismatch (check commas after variable names)')

        # Check 6: offset: not changed
        source_offset = 'offset:' in source
        target_offset = 'offset:' in target

        if source_offset and not target_offset:
            errors.append(f'"offset:" is missing in target')

        # Check 7: Hash symbol (#) preserved in plural contexts
        source_hash = source.count('#')
        target_hash = target.count('#')

        if source_hash > 0 and source_hash != target_hash:
            errors.append(f'Hash (#) count mismatch (source: {source_hash}, target: {target_hash})')

        return errors

    @classmethod
    def generate_suggestions(cls, source: str, target: str) -> Optional[str]:
        """Generate helpful hints for fixing the target"""
        suggestions = []

        # Check for changed variable names
        source_vars = re.findall(r'\{(\w+)\s*,', source)
        target_vars = re.findall(r'\{(\w+)\s*,', target)

        if source_vars and target_vars:
            source_var_set = set(source_vars)
            target_var_set = set(target_vars)
            changed_vars = source_var_set - target_var_set
            if changed_vars:
                suggestions.append(f'Variable names must match source: {", ".join(sorted(changed_vars))}')

        # Check for translated ICU keywords
        for keyword in cls.ICU_KEYWORDS:
            if keyword in source and keyword not in target:
                suggestions.append(f'Restore ICU keyword: "{keyword}" (not translated)')

        # Check for translated categories
        for category in cls.CATEGORY_KEYWORDS:
            source_has = re.search(r'\b' + category + r'\s*\{', source)
            target_has = re.search(r'\b' + category + r'\s*\{', target)
            if source_has and not target_has:
                suggestions.append(f'Restore category keyword: "{category}" (not translated)')

        # Check for offset
        if 'offset:' in source and 'offset:' not in target:
            suggestions.append(f'Restore "offset:" (not translated)')

        # Check for missing braces
        target_open = target.count('{')
        target_close = target.count('}')
        if target_open > target_close:
            suggestions.append(f'Add {target_open - target_close} closing brace(s) }}')
        elif target_close > target_open:
            suggestions.append(f'Add {target_close - target_open} opening brace(s) {{')

        # Check for # symbol
        source_hash = source.count('#')
        target_hash = target.count('#')
        if source_hash > target_hash:
            suggestions.append(f'Restore {source_hash - target_hash} hash symbol(s) #')

        if suggestions:
            return ' • '.join(suggestions)
        else:
            return None
