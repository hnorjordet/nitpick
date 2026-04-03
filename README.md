# QA-App

Unified XLIFF/TMX quality assurance tool combining regex find & replace with spellcheck, terminology validation, and QA checks.

Built with Tauri (Rust) + React/TypeScript + Python CLI backend.

## Features

- **RegEx Find & Replace** — Regex search/replace with tag protection on XLIFF/TMX files
- **Batch QA Profiles** — XML-based profiles with multiple regex checks
- **ICU MessageFormat Validation** — Real-time validation and auto-correction
- **Spellcheck** — Hunspell-based spellchecking with compound word support (Norwegian)
- **Terminology Checks** — DNT, required terms, forbidden terms validation
- **Xbench QA Checks** — 11 standard QA checks (tag mismatch, untranslated, repeated words, etc.)
- **Watch Folder** — Auto-load and batch-process XLIFF files

## Development

```bash
# Set up Python venv
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Install frontend deps
cd gui
npm install

# Run in dev mode
npm run tauri dev
```
