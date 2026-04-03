"""
QA Profile Manager for batch regex checks.
Handles loading, saving, and executing QA profiles.
"""

import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import List, Optional, Dict, Any
from pathlib import Path
from datetime import datetime
import json


@dataclass
class QACheck:
    """Represents a single QA check in a profile."""
    order: int
    enabled: bool
    name: str
    description: str
    pattern: str
    replacement: str
    category: str
    case_sensitive: bool = False
    exclude_pattern: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            'order': self.order,
            'enabled': self.enabled,
            'name': self.name,
            'description': self.description,
            'pattern': self.pattern,
            'replacement': self.replacement,
            'category': self.category,
            'case_sensitive': self.case_sensitive,
            'exclude_pattern': self.exclude_pattern
        }


@dataclass
class QAProfile:
    """Represents a QA profile with metadata and checks."""
    name: str
    description: str
    language: str
    checks: List[QACheck]
    created: Optional[str] = None
    modified: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            'name': self.name,
            'description': self.description,
            'language': self.language,
            'created': self.created,
            'modified': self.modified,
            'checks': [check.to_dict() for check in self.checks]
        }


class QAProfileManager:
    """Manages loading and saving of QA profiles."""

    @staticmethod
    def load_from_xml(xml_path: str) -> QAProfile:
        """Load a QA profile from XML file."""
        tree = ET.parse(xml_path)
        root = tree.getroot()

        # Parse metadata
        metadata = root.find('metadata')
        name = metadata.findtext('name', 'Untitled Profile')
        description = metadata.findtext('description', '')
        language = metadata.findtext('language', '')
        created = metadata.findtext('created', '')
        modified = metadata.findtext('modified', '')

        # Parse checks
        checks = []
        checks_elem = root.find('checks')
        if checks_elem is not None:
            for check_elem in checks_elem.findall('check'):
                order = int(check_elem.get('order', '0'))
                enabled = check_elem.get('enabled', 'true').lower() == 'true'

                exclude_pattern = check_elem.findtext('exclude_pattern', '').strip()
                exclude_pattern = exclude_pattern if exclude_pattern else None

                check = QACheck(
                    order=order,
                    enabled=enabled,
                    name=check_elem.findtext('name', ''),
                    description=check_elem.findtext('description', ''),
                    pattern=check_elem.findtext('pattern', ''),
                    replacement=check_elem.findtext('replacement', ''),
                    category=check_elem.findtext('category', 'Custom'),
                    case_sensitive=check_elem.findtext('case_sensitive', 'false').lower() == 'true',
                    exclude_pattern=exclude_pattern
                )
                checks.append(check)

        # Sort checks by order
        checks.sort(key=lambda c: c.order)

        return QAProfile(
            name=name,
            description=description,
            language=language,
            checks=checks,
            created=created,
            modified=modified
        )

    @staticmethod
    def save_to_xml(profile: QAProfile, xml_path: str) -> None:
        """Save a QA profile to XML file."""
        root = ET.Element('qa_profile')

        # Create metadata
        metadata = ET.SubElement(root, 'metadata')
        ET.SubElement(metadata, 'name').text = profile.name
        ET.SubElement(metadata, 'description').text = profile.description
        ET.SubElement(metadata, 'language').text = profile.language
        ET.SubElement(metadata, 'created').text = profile.created or datetime.now().strftime('%Y-%m-%d')
        ET.SubElement(metadata, 'modified').text = datetime.now().strftime('%Y-%m-%d')

        # Create checks
        checks_elem = ET.SubElement(root, 'checks')
        for check in profile.checks:
            check_elem = ET.SubElement(checks_elem, 'check')
            check_elem.set('order', str(check.order))
            check_elem.set('enabled', str(check.enabled).lower())

            ET.SubElement(check_elem, 'name').text = check.name
            ET.SubElement(check_elem, 'description').text = check.description
            ET.SubElement(check_elem, 'pattern').text = check.pattern
            ET.SubElement(check_elem, 'replacement').text = check.replacement
            ET.SubElement(check_elem, 'category').text = check.category
            ET.SubElement(check_elem, 'case_sensitive').text = str(check.case_sensitive).lower()
            ET.SubElement(check_elem, 'exclude_pattern').text = check.exclude_pattern or ''

        # Write to file with pretty formatting
        tree = ET.ElementTree(root)
        ET.indent(tree, space='    ')
        tree.write(xml_path, encoding='UTF-8', xml_declaration=True)

    @staticmethod
    def list_profiles(profiles_dir: str = None) -> List[Dict[str, str]]:
        """List all available QA profiles in a directory."""
        if profiles_dir is None:
            # Default to samples directory
            profiles_dir = Path(__file__).parent.parent.parent / 'samples'

        profiles_path = Path(profiles_dir)
        if not profiles_path.exists():
            return []

        profile_list = []
        for xml_file in profiles_path.glob('*_qa_profile.xml'):
            try:
                tree = ET.parse(xml_file)
                root = tree.getroot()
                metadata = root.find('metadata')

                profile_list.append({
                    'path': str(xml_file),
                    'name': metadata.findtext('name', xml_file.stem),
                    'description': metadata.findtext('description', ''),
                    'language': metadata.findtext('language', '')
                })
            except Exception as e:
                print(f"Warning: Could not parse {xml_file}: {e}")
                continue

        return profile_list

    @staticmethod
    def get_enabled_checks(profile: QAProfile) -> List[QACheck]:
        """Get only enabled checks from a profile, sorted by order."""
        return [check for check in sorted(profile.checks, key=lambda c: c.order) if check.enabled]
