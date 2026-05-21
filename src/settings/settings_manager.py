"""
Settings manager for Nitpick.
Persists user preferences to ~/.nitpick/settings.json.
"""

import json
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import List


SETTINGS_DIR = Path.home() / ".nitpick"
SETTINGS_PATH = SETTINGS_DIR / "settings.json"


@dataclass
class FileEntry:
    path: str
    enabled: bool = True


DEFAULT_QA_CHECKS = {
    "untranslated": True,
    "source_equals_target": True,
    "inconsistent_source": True,
    "inconsistent_target": True,
    "tag_mismatch": True,
    "url_email_mismatch": True,
    "alphanumeric_mismatch": True,
    "double_blanks": True,
    "repeated_words": True,
    "uppercase_mismatch": True,
    "camelcase_mismatch": True,
}


@dataclass
class Settings:
    dic_folder: str = ""
    selected_dics: List[str] = field(default_factory=list)
    termlists: List[dict] = field(default_factory=list)   # [{path, enabled}]
    checklists: List[dict] = field(default_factory=list)  # [{path, enabled}]
    backup_enabled: bool = True
    strict_lang_match: bool = False
    skip_locked: bool = True        # Skip locked/read-only segments during spellcheck
    skip_100_match: bool = True     # Skip 100%-TM-match segments during all checks
    compound_check: bool = True     # Accept valid compound words (Norwegian heuristic)
    watch_folder_enabled: bool = False  # Auto-load files dropped into a watched folder
    watch_folder: str = ""              # Path to folder to watch
    qa_checks: dict = field(default_factory=lambda: dict(DEFAULT_QA_CHECKS))


def _migrate_legacy_settings() -> None:
    """
    One-time migration from the two pre-merge apps:
      - ~/.spellcheck-qa/settings.json  → spellcheck/terminology settings
      - ~/.xliff-regex-tool/library.xml → not migrated (different format), skipped
    Called only when ~/.nitpick/settings.json does not yet exist.
    """
    legacy_path = Path.home() / ".spellcheck-qa" / "settings.json"
    if not legacy_path.exists():
        return
    try:
        with open(legacy_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        s = Settings()
        # Map fields that exist in both old and new schema
        for field_name in ("dic_folder", "selected_dics", "termlists", "checklists",
                           "backup_enabled", "strict_lang_match", "skip_locked",
                           "skip_100_match", "compound_check",
                           "watch_folder_enabled", "watch_folder"):
            if field_name in data:
                setattr(s, field_name, data[field_name])
        if "qa_checks" in data:
            s.qa_checks = {**DEFAULT_QA_CHECKS, **data["qa_checks"]}
        save(s)
        import sys
        print(f"Migrated settings from {legacy_path}", file=sys.stderr)
    except Exception as e:
        import sys
        print(f"Warning: could not migrate legacy settings from {legacy_path}: {e}",
              file=sys.stderr)


def load() -> Settings:
    """Load settings from disk. Returns defaults if file doesn't exist.
    On first run, migrates settings from the pre-merge ~/.spellcheck-qa/ app.
    """
    if not SETTINGS_PATH.exists():
        _migrate_legacy_settings()
        # If migration wrote the file, load it; otherwise return defaults
        if not SETTINGS_PATH.exists():
            return Settings()
    try:
        with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        s = Settings()
        s.dic_folder = data.get("dic_folder", "")
        s.selected_dics = data.get("selected_dics", [])
        s.termlists = data.get("termlists", [])
        s.checklists = data.get("checklists", [])
        s.backup_enabled = data.get("backup_enabled", True)
        s.strict_lang_match = data.get("strict_lang_match", False)
        s.skip_locked = data.get("skip_locked", True)
        s.skip_100_match = data.get("skip_100_match", True)
        s.compound_check = data.get("compound_check", True)
        s.watch_folder_enabled = data.get("watch_folder_enabled", False)
        s.watch_folder = data.get("watch_folder", "")
        # Merge saved qa_checks with defaults so new checks get added automatically
        saved_qa = data.get("qa_checks", {})
        s.qa_checks = {**DEFAULT_QA_CHECKS, **saved_qa}
        return s
    except Exception as e:
        import sys
        print(f"Warning: failed to load settings: {e}", file=sys.stderr)
        return Settings()


def save(settings: Settings) -> None:
    """Persist settings to disk atomically (write to .tmp, then rename)."""
    SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    tmp_path = SETTINGS_PATH.with_suffix(".tmp")
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(asdict(settings), f, indent=2, ensure_ascii=False)
            f.flush()
            import os
            os.fsync(f.fileno())
        tmp_path.replace(SETTINGS_PATH)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise
