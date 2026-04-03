"""
Xbench Checklist Parser for .xbckl files.
Extracts regex patterns from Xbench checklist files for use in XLIFF processing.
"""

from lxml import etree
from typing import List, Dict, Optional
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ChecklistItem:
    """Represents a single checklist item from Xbench."""
    id: str
    name: str
    search_text: str
    replace_text: Optional[str]
    is_regex: bool
    case_sensitive: bool
    search_in_source: bool
    search_in_target: bool
    enabled: bool
    category: Optional[str] = None
    description: Optional[str] = None


class XbenchParser:
    """
    Parser for Xbench checklist files (.xbckl).

    Xbench checklists are XML files containing QA check definitions,
    including regex patterns that can be reused for find/replace operations.
    """

    def __init__(self, file_path: str):
        self.file_path = Path(file_path)
        self.checklist_items: List[ChecklistItem] = []
        self.checklist_name: str = ""
        self.tree: Optional[etree._ElementTree] = None

    def parse(self) -> bool:
        """
        Parse the Xbench checklist file.

        Returns:
            True if successful, False otherwise
        """
        try:
            parser = etree.XMLParser(strip_cdata=False, remove_blank_text=False)
            self.tree = etree.parse(str(self.file_path), parser)
            root = self.tree.getroot()

            # Get checklist name
            name_elem = root.find('.//ChecklistName')
            if name_elem is not None and name_elem.text:
                self.checklist_name = name_elem.text

            # Find all checklist items
            # Xbench uses different element names depending on the check type
            self._parse_checklist_items(root)

            return True

        except Exception as e:
            print(f"Error parsing Xbench checklist: {e}")
            return False

    def _parse_checklist_items(self, root: etree._Element) -> None:
        """Extract all checklist items from the XML."""

        # Look for common Xbench item elements
        # Xbench format varies, but common patterns include:
        # - ChecklistItem
        # - PowerSearchItem
        # - QAItem

        item_paths = [
            './/ChecklistItem',
            './/PowerSearchItem',
            './/Item',
            './/QAItem'
        ]

        for xpath in item_paths:
            for item_elem in root.findall(xpath):
                checklist_item = self._parse_item(item_elem)
                if checklist_item:
                    self.checklist_items.append(checklist_item)

    def _parse_item(self, element: etree._Element) -> Optional[ChecklistItem]:
        """Parse a single checklist item element."""
        try:
            # Extract common fields
            item_id = element.get('id', element.get('ID', ''))

            # Name/Description
            name = self._get_text(element, ['Name', 'Description', 'Text'])

            # Search text (the actual pattern)
            search_text = self._get_text(element, [
                'SearchText', 'Search', 'Pattern', 'FindText', 'SourceText'
            ])

            if not search_text:
                return None  # Must have search text

            # Replace text (if this is a find/replace pattern)
            replace_text = self._get_text(element, [
                'ReplaceText', 'Replace', 'Replacement', 'TargetText'
            ])

            # Regex flag
            is_regex = self._get_bool(element, [
                'IsRegEx', 'IsRegex', 'RegEx', 'UseRegex', 'RegularExpression'
            ])

            # Case sensitivity
            case_sensitive = self._get_bool(element, [
                'CaseSensitive', 'MatchCase', 'CaseMatching'
            ])

            # Where to search
            search_in_source = self._get_bool(element, [
                'SearchInSource', 'CheckSource', 'Source'
            ], default=True)

            search_in_target = self._get_bool(element, [
                'SearchInTarget', 'CheckTarget', 'Target'
            ], default=True)

            # Enabled status
            enabled = self._get_bool(element, [
                'Enabled', 'Active', 'IsEnabled'
            ], default=True)

            # Category/Group
            category = self._get_text(element, ['Category', 'Group', 'Type'])

            # Description
            description = self._get_text(element, [
                'Description', 'Comment', 'Notes', 'Help'
            ])

            return ChecklistItem(
                id=item_id or f"item_{len(self.checklist_items)}",
                name=name or "Unnamed Item",
                search_text=search_text,
                replace_text=replace_text if replace_text else None,
                is_regex=is_regex,
                case_sensitive=case_sensitive,
                search_in_source=search_in_source,
                search_in_target=search_in_target,
                enabled=enabled,
                category=category,
                description=description
            )

        except Exception as e:
            print(f"Error parsing checklist item: {e}")
            return None

    def _get_text(self, element: etree._Element, tag_names: List[str]) -> str:
        """Get text from first matching child element."""
        for tag in tag_names:
            child = element.find(f'.//{tag}')
            if child is not None and child.text:
                return child.text.strip()

            # Also check as attribute
            attr = element.get(tag)
            if attr:
                return attr.strip()

        return ""

    def _get_bool(self, element: etree._Element, tag_names: List[str],
                  default: bool = False) -> bool:
        """Get boolean value from first matching child element or attribute."""
        for tag in tag_names:
            child = element.find(f'.//{tag}')
            if child is not None:
                text = (child.text or '').lower().strip()
                return text in ('true', '1', 'yes', 'on')

            # Check as attribute
            attr = element.get(tag)
            if attr:
                return attr.lower().strip() in ('true', '1', 'yes', 'on')

        return default

    def get_regex_items(self) -> List[ChecklistItem]:
        """Get only items that use regex patterns."""
        return [item for item in self.checklist_items if item.is_regex]

    def get_enabled_items(self) -> List[ChecklistItem]:
        """Get only enabled checklist items."""
        return [item for item in self.checklist_items if item.enabled]

    def get_items_by_category(self, category: str) -> List[ChecklistItem]:
        """Get items filtered by category."""
        return [item for item in self.checklist_items
                if item.category and item.category.lower() == category.lower()]

    def export_as_patterns(self) -> List[Dict[str, str]]:
        """
        Export checklist items as simple pattern dictionaries.
        Useful for importing into the main regex tool.

        Returns:
            List of dicts with 'name', 'pattern', 'replacement' keys
        """
        patterns = []

        for item in self.get_enabled_items():
            if item.is_regex:
                pattern_dict = {
                    'name': item.name,
                    'pattern': item.search_text,
                    'replacement': item.replace_text or '',
                    'case_sensitive': item.case_sensitive,
                    'search_source': item.search_in_source,
                    'search_target': item.search_in_target,
                    'category': item.category or 'Uncategorized'
                }

                if item.description:
                    pattern_dict['description'] = item.description

                patterns.append(pattern_dict)

        return patterns

    def get_statistics(self) -> Dict[str, int]:
        """Get statistics about the checklist."""
        return {
            'total_items': len(self.checklist_items),
            'regex_items': len(self.get_regex_items()),
            'enabled_items': len(self.get_enabled_items()),
            'with_replacement': sum(1 for item in self.checklist_items
                                   if item.replace_text)
        }
