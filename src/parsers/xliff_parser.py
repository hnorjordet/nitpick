"""
XLIFF Parser for handling XLIFF, MQXLIFF, and SDLXLIFF files.
Preserves XML structure and tags while enabling regex operations on translatable content.
"""

from lxml import etree
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass
from pathlib import Path


@dataclass
class TransUnit:
    """Represents a translation unit with source and target segments."""
    id: str
    source: etree._Element
    target: Optional[etree._Element]
    element: etree._Element  # Reference to the original trans-unit element
    tms_metadata: Optional[Dict[str, str]] = None  # TMS integration metadata

    def get_source_text(self) -> str:
        """Extract text content from source, preserving inline tags."""
        return self._get_text_with_tags(self.source)

    def get_target_text(self) -> str:
        """Extract text content from target, preserving inline tags."""
        if self.target is None:
            return ""
        return self._get_text_with_tags(self.target)

    def _get_text_with_tags(self, element: etree._Element) -> str:
        """
        Convert element to string with tags preserved.
        This is crucial for maintaining XLIFF tag structure.
        Handles SDLXLIFF <mrk> wrapper tags by stripping them.
        """
        if element is None:
            return ""

        # Use tostring to get inner content, then extract from root element wrapper
        # This preserves both tags and text properly
        content = etree.tostring(element, encoding='unicode', method='xml')

        # Extract content between opening and closing tags
        tag_name = etree.QName(element).localname
        start_tag_end = content.find('>')
        end_tag_start = content.rfind(f'</{tag_name}>')

        if start_tag_end >= 0 and end_tag_start > start_tag_end:
            inner_content = content[start_tag_end + 1:end_tag_start]

            # Strip SDLXLIFF <mrk> wrapper tags and <g> group tags
            # These are formatting wrappers that shouldn't be shown in UI
            import re
            # Remove opening <mrk> tags (SDLXLIFF)
            inner_content = re.sub(r'<mrk\s+[^>]*>', '', inner_content)
            # Remove closing </mrk> tags
            inner_content = re.sub(r'</mrk>', '', inner_content)
            # Remove opening <g> tags (group tags)
            inner_content = re.sub(r'<g\s+[^>]*>', '', inner_content)
            # Remove closing </g> tags
            inner_content = re.sub(r'</g>', '', inner_content)

            return inner_content

        return ""

    def set_target_text(self, new_text: str) -> None:
        """
        Update target text while preserving XML structure.
        This parses the new text to maintain inline tags.
        """
        if self.target is None:
            # Create target element if it doesn't exist
            self.target = etree.SubElement(self.element,
                                          f"{{{self.element.nsmap[None]}}}target")

        # Clear existing content
        self.target.clear()
        self.target.text = None
        self.target.tail = None

        # Parse and insert new content
        try:
            # Wrap in temporary element to parse fragment
            wrapper = etree.fromstring(f"<temp>{new_text}</temp>")

            # Set text and copy children
            self.target.text = wrapper.text
            for child in wrapper:
                self.target.append(child)

        except etree.XMLSyntaxError:
            # If parsing fails, treat as plain text
            self.target.text = new_text


class XLIFFParser:
    """
    Parser for XLIFF files with support for different variants.
    Handles XLIFF 1.2 (standard), MXLIFF (Phrase), MQXLIFF (MemoQ), and SDLXLIFF (Trados).
    """

    # Common XLIFF namespaces and variants
    XLIFF_NAMESPACES = {
        'xliff': 'urn:oasis:names:tc:xliff:document:1.2',
        'xliff20': 'urn:oasis:names:tc:xliff:document:2.0',
        'phrase': 'urn:oasis:names:tc:xliff:document:1.2',  # Phrase uses standard namespace
        'mq': 'MQXliff',
        'sdl': 'http://sdl.com/FileTypes/SdlXliff/1.0'
    }

    # Supported file extensions
    SUPPORTED_EXTENSIONS = {'.xliff', '.xlf', '.mxliff', '.mqxliff', '.sdlxliff'}

    def __init__(self, file_path: str):
        self.file_path = Path(file_path)
        self.tree: Optional[etree._ElementTree] = None
        self.root: Optional[etree._Element] = None
        self.trans_units: List[TransUnit] = []
        self.phrase_job_uid: Optional[str] = None  # For Phrase TMS integration

    def parse(self) -> bool:
        """
        Parse the XLIFF file and extract translation units.
        Returns True if successful, False otherwise.
        """
        try:
            # Parse XML with lxml (preserves structure better than xml.etree)
            parser = etree.XMLParser(strip_cdata=False, remove_blank_text=False)
            self.tree = etree.parse(str(self.file_path), parser)
            self.root = self.tree.getroot()

            # Extract namespace map
            nsmap = self.root.nsmap
            default_ns = nsmap.get(None, self.XLIFF_NAMESPACES['xliff'])

            # Extract Phrase/Memsource job UID from file element for TMS integration
            file_elements = self.root.xpath(".//ns:file", namespaces={'ns': default_ns})
            if file_elements:
                file_elem = file_elements[0]
                # Check for Memsource/Phrase job-uid attribute
                for attr_name, attr_value in file_elem.attrib.items():
                    if 'job-uid' in attr_name:
                        self.phrase_job_uid = attr_value
                        break

            # Find all trans-unit elements
            # These can be in different locations depending on XLIFF variant
            trans_unit_xpath = ".//ns:trans-unit"
            namespaces = {'ns': default_ns}

            for tu_element in self.root.xpath(trans_unit_xpath, namespaces=namespaces):
                trans_units = self._parse_trans_unit(tu_element, default_ns)
                if trans_units:
                    # _parse_trans_unit now returns a list
                    self.trans_units.extend(trans_units)

            return True

        except Exception as e:
            print(f"Error parsing XLIFF file: {e}")
            return False

    def _parse_trans_unit(self, element: etree._Element, namespace: str) -> List[TransUnit]:
        """Parse a single trans-unit element. Returns a list of TransUnit objects.
        For SDLXLIFF with <mrk mtype="seg"> sub-segments, returns multiple TransUnits.
        """
        try:
            tu_id = element.get('id', '')

            # Extract TMS metadata from trans-unit attributes
            tms_metadata = {}
            for attr_name, attr_value in element.attrib.items():
                # Lingotek: lgtk:task-segment-url
                if 'task-segment-url' in attr_name:
                    tms_metadata['lingotek_url'] = attr_value
                    tms_metadata['tms_type'] = 'lingotek'
                # Phrase: Add support if needed in future
                elif 'phrase' in attr_name.lower() and 'segment-url' in attr_name.lower():
                    tms_metadata['phrase_url'] = attr_value
                    tms_metadata['tms_type'] = 'phrase'

            # Phrase/Memsource: Build URL from job-uid and para-id
            if not tms_metadata and self.phrase_job_uid:
                # Look for m:para-id attribute - this is the ID Phrase uses for navigation
                para_id = None
                for attr_name, attr_value in element.attrib.items():
                    if 'para-id' in attr_name:
                        para_id = attr_value
                        break

                if para_id is not None:
                    # Phrase URL format: https://cloud.memsource.com/web/job/{job-uid}/translate#{para-id}
                    phrase_url = f"https://cloud.memsource.com/web/job/{self.phrase_job_uid}/translate#{para_id}"
                    tms_metadata['phrase_url'] = phrase_url
                    tms_metadata['tms_type'] = 'phrase'

            # Only include tms_metadata if we found something
            tms_data = tms_metadata if tms_metadata else None

            # Find source and target elements
            namespaces = {'ns': namespace, 'sdl': self.XLIFF_NAMESPACES['sdl']}

            # Check if this is SDLXLIFF format (has seg-source)
            seg_source = element.find("ns:seg-source", namespaces=namespaces)

            if seg_source is not None:
                # SDLXLIFF: check for <mrk mtype="seg"> sub-segments
                mrk_segments = seg_source.findall(".//ns:mrk[@mtype='seg']", namespaces=namespaces)

                if mrk_segments:
                    # Split into multiple segments based on <mrk> tags
                    trans_units = []
                    target = element.find("ns:target", namespaces=namespaces)

                    for mrk in mrk_segments:
                        mid = mrk.get('mid', '')
                        if not mid:
                            continue

                        # Create a copy of the source element with only this <mrk> content
                        source_copy = etree.Element(seg_source.tag, nsmap=seg_source.nsmap)
                        source_copy.text = mrk.text
                        source_copy.tail = mrk.tail
                        for child in mrk:
                            source_copy.append(child)

                        # Find corresponding <mrk> in target
                        target_copy = None
                        if target is not None:
                            target_mrk = target.find(f".//ns:mrk[@mid='{mid}']", namespaces=namespaces)
                            if target_mrk is not None:
                                target_copy = etree.Element(target.tag, nsmap=target.nsmap)
                                target_copy.text = target_mrk.text
                                target_copy.tail = target_mrk.tail
                                for child in target_mrk:
                                    target_copy.append(child)

                        # Use mid as the segment ID
                        trans_units.append(TransUnit(
                            id=mid,
                            source=source_copy,
                            target=target_copy,
                            element=element,  # Keep reference to parent trans-unit
                            tms_metadata=tms_data
                        ))

                    return trans_units
                else:
                    # SDLXLIFF without sub-segments: use seg-source as single segment
                    source = seg_source
            else:
                # Standard XLIFF: use source
                source = element.find("ns:source", namespaces=namespaces)

            target = element.find("ns:target", namespaces=namespaces)

            if source is None:
                return []

            return [TransUnit(
                id=tu_id,
                source=source,
                target=target,
                element=element,
                tms_metadata=tms_data
            )]

        except Exception as e:
            print(f"Error parsing trans-unit: {e}")
            return []

    def get_trans_units(self) -> List[TransUnit]:
        """Get all parsed translation units."""
        return self.trans_units

    def save(self, output_path: Optional[str] = None) -> bool:
        """
        Save the modified XLIFF file.
        If output_path is None, overwrites the original file.
        """
        try:
            save_path = output_path if output_path else str(self.file_path)

            # Write with proper XML declaration and encoding
            self.tree.write(
                save_path,
                encoding='utf-8',
                xml_declaration=True,
                pretty_print=True
            )

            return True

        except Exception as e:
            print(f"Error saving XLIFF file: {e}")
            return False

    def get_statistics(self) -> Dict[str, int]:
        """Get statistics about the XLIFF file."""
        stats = {
            'total_units': len(self.trans_units),
            'translated': sum(1 for tu in self.trans_units if tu.target is not None),
            'untranslated': sum(1 for tu in self.trans_units if tu.target is None)
        }
        return stats
