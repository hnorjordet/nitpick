"""
xliff_merger.py — Merge multiple XLIFF files into one.

Adapted from xliffmerge.py for use as a library module in SpellcheckQA.
"""

from pathlib import Path
from xml.etree import ElementTree as ET

# Preserve namespace prefixes
ET.register_namespace("", "urn:oasis:names:tc:xliff:document:1.2")
ET.register_namespace("xsi", "http://www.w3.org/2001/XMLSchema-instance")
ET.register_namespace("sdl", "http://sdl.com/FileTypes/SdlXliff/1.0")
ET.register_namespace("mq", "MQXliff")

XLIFF_NS = "urn:oasis:names:tc:xliff:document:1.2"
XLIFF_EXTENSIONS = {".xlf", ".xliff", ".mxliff", ".mqxliff", ".sdlxliff"}


def scan_folder(folder: str) -> list[str]:
    """Return sorted list of XLIFF file paths in a folder (non-recursive)."""
    folder_path = Path(folder)
    found = []
    for f in folder_path.iterdir():
        if f.is_file() and f.suffix.lower() in XLIFF_EXTENSIONS:
            found.append(str(f))
    return sorted(found)


def suggest_output_name(input_files: list[str], folder: str) -> str:
    """Suggest a sensible merged output filename in the given folder."""
    if not input_files:
        return str(Path(folder) / "merged.xliff")
    first = Path(input_files[0])
    stem = first.stem.rstrip("0123456789_- ")
    ext = first.suffix or ".xliff"
    return str(Path(folder) / f"{stem}_merged{ext}")


def merge_xliff_files(input_files: list[str], output_path: str) -> dict:
    """
    Merge a list of XLIFF files into a single output file.

    Returns a dict with:
      ok: bool
      output_path: str
      files_merged: int
      total_segments: int
      warnings: list[str]
      error: str | None
    """
    warnings = []

    if len(input_files) < 2:
        return {"ok": False, "error": "Need at least 2 files to merge.", "warnings": []}

    def parse(path):
        try:
            return ET.parse(path)
        except ET.ParseError as e:
            warnings.append(f"Could not parse {Path(path).name}: {e}")
            return None

    def get_file_elements(tree, path):
        root = tree.getroot()
        ns = {"x": XLIFF_NS}
        elems = root.findall("x:file", ns) or root.findall("file")
        if not elems:
            warnings.append(f"No <file> elements found in {Path(path).name}")
        return elems

    base_tree = parse(input_files[0])
    if base_tree is None:
        return {"ok": False, "error": f"Could not read base file: {Path(input_files[0]).name}", "warnings": warnings}

    base_root = base_tree.getroot()
    ns = {"x": XLIFF_NS}

    all_file_elems = get_file_elements(base_tree, input_files[0])
    seen_originals = {f.get("original") for f in all_file_elems}
    files_merged = 1

    for source_path in input_files[1:]:
        tree = parse(source_path)
        if tree is None:
            continue
        for file_el in get_file_elements(tree, source_path):
            original = file_el.get("original", "")
            if original in seen_originals:
                warnings.append(f"Duplicate 'original' skipped: {original}")
                continue
            seen_originals.add(original)
            base_root.append(file_el)
        files_merged += 1

    # Don't overwrite an input file
    out = Path(output_path)
    if str(out) in input_files:
        out = out.with_stem(out.stem + "_merged")

    ET.indent(base_root, space="  ")
    base_tree.write(str(out), encoding="utf-8", xml_declaration=True)

    total_segments = len(base_root.findall(".//x:trans-unit", ns)) or len(base_root.findall(".//trans-unit"))

    return {
        "ok": True,
        "output_path": str(out),
        "files_merged": files_merged,
        "total_segments": total_segments,
        "warnings": warnings,
        "error": None,
    }
