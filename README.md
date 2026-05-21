# Nitpick

A desktop QA tool for translators and localization engineers working with XLIFF, MQXLIFF, SDLXLIFF, TMX, and DOCX files.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Multi-format support** — XLIFF 1.2, MQXLIFF (memoQ), SDLXLIFF (Trados), TMX, and DOCX bilingual tables
- **Regex find & replace** — Full regex with capture groups, backreferences, and tag protection
- **Spellcheck** — Built-in spellcheck against Norwegian Bokmål and other languages
- **Terminology checks** — Validate translations against custom term lists
- **Batch QA checks** — Reusable profiles with multiple regex patterns
- **ICU message format** — Validation and one-click auto-fix for ICU syntax errors
- **TMS integration** — Open segments directly in Phrase/Memsource or Lingotek
- **XTM support** — Match quality via alt-trans and state-qualifier
- **Regex library** — Save and organize frequently used patterns
- **Auto-updates** — Built-in update mechanism via GitHub Releases
- **Dark mode** — Comfortable dark theme

## Download

Download the latest version from the [Releases](https://github.com/hnorjordet/nitpick/releases) page.

### macOS Installation

1. Download `Nitpick_<version>_aarch64.dmg`
2. Open the DMG and drag Nitpick to your Applications folder
3. Open Terminal and run:
   ```bash
   xattr -cr /Applications/Nitpick.app
   ```
4. Launch Nitpick normally from Applications or the Dock

> **Why is this needed?** Nitpick is not signed with an Apple Developer certificate, so macOS Gatekeeper will block it on first launch. The `xattr -cr` command removes the quarantine flag. This is a one-time step.

## Building from Source

### Prerequisites

- Python 3.11+
- Node.js 18+
- Rust (for Tauri)

### Setup

```bash
git clone https://github.com/hnorjordet/nitpick.git
cd nitpick

python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

cd gui
npm install
```

### Development

```bash
cd gui
npm run tauri dev
```

### Build for Production

```bash
cd gui
npm run tauri build
```

The DMG will be created in `gui/src-tauri/target/release/bundle/dmg/`.

## Architecture

```
nitpick/
├── src/                    # Python backend
│   ├── parsers/            # File format parsers (XLIFF, TMX, DOCX)
│   ├── spellcheck/         # Spell engine
│   ├── settings/           # Settings manager
│   └── cli.py              # CLI interface
├── gui/                    # Tauri frontend
│   ├── src/                # React + TypeScript UI
│   └── src-tauri/          # Rust backend
├── samples/                # Example QA profiles
└── build_cli.sh            # PyInstaller build script
```

## Technology Stack

- **Frontend**: React + TypeScript + Vite
- **Desktop**: Tauri (Rust)
- **Backend**: Python (bundled via PyInstaller)
- **Parsers**: lxml
- **Regex**: Python `regex` module

## Documentation

- [Changelog](CHANGELOG.md)
- [Build Instructions](BUILD.md)

## License

MIT License — see LICENSE file for details.

## Author

Created by Håvard Nørjordet

## Support

- Report issues: [GitHub Issues](https://github.com/hnorjordet/nitpick/issues)
- Feature requests: [GitHub Discussions](https://github.com/hnorjordet/nitpick/discussions)
