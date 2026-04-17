"""
Adapter that converts RegEx tool TransUnit objects to SpellcheckQA Segment objects.
This allows SpellcheckQA modules (spellcheck, terminology, qachecks) to work
unchanged with the RegEx tool's parser.
"""

from dataclasses import dataclass
from typing import List


@dataclass
class Segment:
    """SpellcheckQA-compatible segment representation."""
    id: str
    source_plain: str
    target_plain: str
    target_raw: str
    source_raw: str
    file_name: str
    target_element: object  # lxml element reference for write-back
    parent_element: object  # trans-unit element reference
    is_locked: bool = False
    match_percent: object = None  # Optional[int] — TM match %, None if unknown


def trans_units_to_segments(trans_units, default_file_name: str = "") -> List[Segment]:
    """Convert a list of RegEx TransUnit objects to SpellcheckQA Segment objects."""
    segments = []
    for tu in trans_units:
        segments.append(Segment(
            id=tu.id,
            source_plain=tu.get_plain_text("source"),
            target_plain=tu.get_plain_text("target"),
            target_raw=tu.get_inner_xml("target"),
            source_raw=tu.get_inner_xml("source"),
            file_name=tu.file_name or default_file_name,
            target_element=tu.target,
            parent_element=tu.element,
            is_locked=tu.is_locked,
            match_percent=tu.match_percent,
        ))
    return segments
