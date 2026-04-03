"""
Dictionary file manager for SpellcheckQA.
Handles listing, reading, and modifying Hunspell .dic files,
with optional timestamped snapshot backups.
"""

import shutil
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Optional


@dataclass
class DicInfo:
    name: str        # filename without directory
    path: str        # absolute path to .dic file
    aff_path: str    # absolute path to corresponding .aff file (empty string if flat/no .aff)
    word_count: int  # as reported by first line of .dic file
    has_aff: bool = True  # False for flat word lists without affix rules


def _read_word_count(dic_path: Path) -> int:
    """Read the word count from the first line of a .dic file."""
    try:
        with open(dic_path, "r", encoding="utf-8") as f:
            first = f.readline().strip()
            return int(first)
    except (ValueError, OSError):
        return 0


def list_dics(folder: str) -> List[DicInfo]:
    """
    List all .dic files in the given folder.
    Dictionaries with a matching .aff file are loaded as full Hunspell dictionaries
    (with affix/inflection rules). Dictionaries without a .aff are treated as flat
    word lists (every line is an accepted word form, no inflection expansion).
    Returns DicInfo objects sorted by filename.
    """
    folder_path = Path(folder)
    if not folder_path.exists() or not folder_path.is_dir():
        return []

    result: List[DicInfo] = []
    for dic_file in sorted(folder_path.glob("*.dic")):
        # Skip backup snapshots
        if "-pic_" in dic_file.name:
            continue
        aff_file = dic_file.with_suffix(".aff")
        has_aff = aff_file.exists()
        result.append(
            DicInfo(
                name=dic_file.name,
                path=str(dic_file),
                aff_path=str(aff_file) if has_aff else "",
                word_count=_read_word_count(dic_file),
                has_aff=has_aff,
            )
        )
    return result


def make_backup(dic_path: str) -> str:
    """
    Create a timestamped snapshot of a .dic file.
    Format: nb_NO_ordbank.dic-pic_2026-03-03_14-22-01
    Returns the path to the backup file.
    """
    src = Path(dic_path)
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    backup_name = f"{src.name}-pic_{timestamp}"
    backup_path = src.parent / backup_name
    shutil.copy2(src, backup_path)
    return str(backup_path)


def add_word(word: str, dic_path: str, backup: bool = True) -> int:
    """
    Add a word to a Hunspell .dic file.
    - Takes a timestamped backup first (if backup=True).
    - Increments the word count on the first line.
    - Appends the word on a new line.
    Returns the new word count, or -1 on failure.
    """
    path = Path(dic_path)
    if not path.exists():
        print(f"Dictionary not found: {dic_path}", file=sys.stderr)
        return -1

    if backup:
        try:
            make_backup(dic_path)
        except Exception as e:
            print(f"Warning: backup failed: {e}", file=sys.stderr)

    try:
        with open(path, "r", encoding="utf-8") as f:
            lines = f.readlines()

        if not lines:
            lines = ["0\n"]

        # Parse and increment count
        try:
            count = int(lines[0].strip())
        except ValueError:
            count = 0
        count += 1
        lines[0] = f"{count}\n"

        # Check if word already exists (exact match, case-sensitive)
        # Only compare the part before the first /
        existing = {line.split("/")[0].strip() for line in lines[1:]}
        if word in existing:
            return count - 1  # already present, undo increment logic
            # Reset count since we didn't actually add
        else:
            lines.append(f"{word}\n")
            # Write atomically using a temp file
            tmp_path = path.with_suffix(".dic.tmp")
            with open(tmp_path, "w", encoding="utf-8") as f:
                f.writelines(lines)
            tmp_path.replace(path)
            return count

    except Exception as e:
        print(f"Failed to add word to dictionary: {e}", file=sys.stderr)
        return -1
