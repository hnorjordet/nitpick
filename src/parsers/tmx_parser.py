"""
TMX (Translation Memory eXchange) Parser.
Handles TMX 1.4 files, extracting translation units with source and target segments.
Preserves XML structure to allow saving modifications back to the file.
"""

from lxml import etree
from typing import List, Dict, Optional
from pathlib import Path

from parsers.xliff_parser import TransUnit

# xml:lang namespace URI
XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace'
LANG_ATTR = f'{{{XML_NAMESPACE}}}lang'


class TMXParser:
    """
    Parser for TMX 1.4 files.
    Reuses the TransUnit class from xliff_parser for compatibility with the rest of the pipeline.
    """

    SUPPORTED_EXTENSIONS = {'.tmx'}

    def __init__(self, file_path: str, target_lang: Optional[str] = None):
        self.file_path = Path(file_path)
        self.target_lang = target_lang  # If None, use first non-source language
        self.tree: Optional[etree._ElementTree] = None
        self.root: Optional[etree._Element] = None
        self.trans_units: List[TransUnit] = []
        self.srclang: str = 'en'
        self.available_languages: List[str] = []

    def parse(self) -> bool:
        """
        Parse the TMX file and extract translation units.
        Returns True if successful, False otherwise.
        """
        try:
            parser = etree.XMLParser(strip_cdata=False, remove_blank_text=False)
            self.tree = etree.parse(str(self.file_path), parser)
            self.root = self.tree.getroot()

            # Extract source language from header
            header = self.root.find('header')
            if header is not None:
                self.srclang = header.get('srclang', 'en').lower()

            # Collect all available languages from the file
            self.available_languages = self._collect_languages()

            # Determine target language
            resolved_target = self._resolve_target_lang()

            # Parse all <tu> elements
            body = self.root.find('body')
            if body is None:
                return False

            for i, tu_element in enumerate(body.findall('tu')):
                tu = self._parse_tu(tu_element, resolved_target, i + 1)
                if tu is not None:
                    self.trans_units.append(tu)

            return True

        except Exception as e:
            print(f"Error parsing TMX file: {e}")
            return False

    def _collect_languages(self) -> List[str]:
        """Collect all unique language codes present in the file."""
        langs = set()
        body = self.root.find('body')
        if body is None:
            return []
        for tu in body.findall('tu'):
            for tuv in tu.findall('tuv'):
                lang = tuv.get(LANG_ATTR, '').strip()
                if lang:
                    langs.add(lang)
        return sorted(langs)

    def _resolve_target_lang(self) -> Optional[str]:
        """
        Determine which language to use as target.
        If target_lang is set, use that. Otherwise use first non-source language.
        """
        if self.target_lang:
            return self.target_lang

        for lang in self.available_languages:
            if not lang.lower().startswith(self.srclang.lower()):
                return lang

        return None

    def _find_tuv_for_lang(self, tu_element: etree._Element, lang: str) -> Optional[etree._Element]:
        """Find <tuv> element matching the given language code (case-insensitive, prefix match)."""
        for tuv in tu_element.findall('tuv'):
            tuv_lang = tuv.get(LANG_ATTR, '').strip().lower()
            if tuv_lang == lang.lower() or tuv_lang.startswith(lang.lower().split('-')[0]):
                return tuv
        return None

    def _parse_tu(self, tu_element: etree._Element, target_lang: Optional[str], index: int) -> Optional[TransUnit]:
        """Parse a single <tu> element into a TransUnit."""
        try:
            tuid = tu_element.get('tuid', str(index))

            # Find source tuv
            source_tuv = self._find_tuv_for_lang(tu_element, self.srclang)
            if source_tuv is None:
                return None

            source_seg = source_tuv.find('seg')
            if source_seg is None:
                return None

            # Find target tuv
            target_seg = None
            if target_lang:
                target_tuv = self._find_tuv_for_lang(tu_element, target_lang)
                if target_tuv is not None:
                    target_seg = target_tuv.find('seg')

            # Extract metadata from <tu> attributes
            metadata = self._extract_metadata(tu_element)

            return TransUnit(
                id=tuid,
                source=source_seg,
                target=target_seg,
                element=tu_element,
                tms_metadata=metadata if metadata else None
            )

        except Exception as e:
            print(f"Error parsing TMX tu element: {e}")
            return None

    def _extract_metadata(self, tu_element: etree._Element) -> Dict[str, str]:
        """Extract metadata from <tu> attributes."""
        metadata = {}
        attr_map = {
            'creationdate': 'created_date',
            'creationid':   'created_by',
            'changedate':   'modified_date',
            'changeid':     'modified_by',
        }
        for attr, field in attr_map.items():
            val = tu_element.get(attr)
            if val:
                # Normalize TMX date format (YYYYMMDDTHHmmSSZ) to readable
                if 'date' in attr and 'T' in val:
                    try:
                        from datetime import datetime
                        dt = datetime.strptime(val.rstrip('Z'), '%Y%m%dT%H%M%S')
                        val = dt.strftime('%Y-%m-%d %H:%M:%S')
                    except Exception:
                        pass
                metadata[field] = val
        return metadata

    def get_trans_units(self) -> List[TransUnit]:
        """Get all parsed translation units."""
        return self.trans_units

    def save(self, output_path: Optional[str] = None) -> bool:
        """Save the modified TMX file, preserving XML structure."""
        try:
            save_path = output_path if output_path else str(self.file_path)
            self.tree.write(
                save_path,
                encoding='utf-8',
                xml_declaration=True,
                pretty_print=True
            )
            return True
        except Exception as e:
            print(f"Error saving TMX file: {e}")
            return False

    def get_statistics(self) -> Dict[str, int]:
        """Get statistics about the TMX file."""
        return {
            'total_units': len(self.trans_units),
            'translated': sum(1 for tu in self.trans_units if tu.target is not None),
            'untranslated': sum(1 for tu in self.trans_units if tu.target is None)
        }

    def get_available_languages(self) -> List[str]:
        """Return all language codes found in the file."""
        return self.available_languages
