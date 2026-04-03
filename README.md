# XLIFF RegEx Tool

A powerful desktop application for Find & Replace operations with regex support directly on XLIFF translation files.

![Version](https://img.shields.io/badge/version-0.4.5-blue)
![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Multi-format Support**: Works with XLIFF, MQXLIFF (memoQ), and SDLXLIFF (SDL Trados)
- **Regex Find & Replace**: Full regex support with capture groups and backreferences
- **Tag Protection**: Automatically preserves XML/HTML tags, including escaped entities (`&lt;`, `&amp;lt;`)
- **Dual Search**: Search in source and target simultaneously with separate patterns
- **Batch Checks**: Create reusable QA profiles with multiple regex patterns
- **ICU Message Format**: Automatic validation and error correction for ICU syntax
- **Regex Library**: Save and organize frequently used regex patterns
- **Automatic Backups**: Creates backup before any changes
- **Auto-Updates**: Built-in update mechanism via GitHub Releases
- **Dark Mode**: Comfortable dark theme support

## Download

Download the latest version from the [Releases](https://github.com/hnorjordet/xliff-regex-tool/releases) page.

### macOS Installation

1. Download `XLIFF.RegEx.Tool_<version>_aarch64.dmg`
2. Open the DMG file
3. Drag the app to your Applications folder
4. On first launch, right-click the app and select "Open" (security requirement)

## Usage

### Basic Find & Replace

1. Open an XLIFF file (File → Open or Cmd+O)
2. Enter your search pattern (supports regex)
3. Enter replacement pattern (use `$1`, `$2` for capture groups)
4. Enable "Ignore Tags" to search only text content
5. Click "Replace All" or review matches individually

### Batch Checks

Create QA profiles with multiple regex patterns:

1. Click "Batch Checks" → "Manage Profiles"
2. Create a new profile
3. Add multiple regex patterns with descriptions
4. Run the profile against your file
5. Review and apply fixes selectively

### Regex Library

Save frequently used patterns:

1. Click "Regex Library"
2. Add patterns with names and descriptions
3. Organize by categories
4. Load patterns with one click

## Building from Source

### Prerequisites

- Python 3.14+
- Node.js 18+
- Rust (for Tauri)

### Setup

```bash
# Clone repository
git clone https://github.com/hnorjordet/xliff-regex-tool.git
cd xliff-regex-tool

# Create Python virtual environment
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install Python dependencies
pip install -r requirements.txt

# Install Node dependencies
cd gui
npm install
```

### Development

```bash
# Run in development mode
cd gui
npm run tauri dev
```

### Build for Production

```bash
# Build standalone executable and DMG
cd gui
npm run tauri build
```

The DMG file will be created in `gui/src-tauri/target/release/bundle/dmg/`

## Architecture

```
xliff-regex-tool/
├── src/                    # Python backend
│   ├── parsers/           # XLIFF/MXLIFF parsers
│   ├── regex_engine/      # Regex processing with tag preservation
│   ├── backup/            # Backup management
│   ├── qa/                # Batch check profiles
│   ├── validators/        # ICU message format validation
│   └── cli.py             # CLI interface
├── gui/                    # Tauri frontend
│   ├── src/               # React TypeScript UI
│   └── src-tauri/         # Rust backend
├── build_cli.sh           # PyInstaller build script
└── samples/               # Sample XLIFF files

```

## Technology Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Rust (Tauri) + Python
- **Parser**: lxml (Python)
- **Regex Engine**: Python `regex` module
- **Packaging**: PyInstaller + Tauri

## Documentation

- [User Guide](USER_GUIDE.html) - Complete feature documentation
- [Changelog](CHANGELOG.md) - Version history and changes
- [Build Instructions](BUILD.md) - Detailed build guide
- [GitHub Releases Setup](GITHUB_RELEASES_SETUP.md) - How to publish releases

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - See LICENSE file for details

## Author

Created by Håvard Nørjordet

## Support

- Report issues: [GitHub Issues](https://github.com/hnorjordet/xliff-regex-tool/issues)
- Feature requests: [GitHub Discussions](https://github.com/hnorjordet/xliff-regex-tool/discussions)

---

**Note**: This tool is designed for professional translators and localization engineers working with XLIFF files. Basic knowledge of regular expressions is recommended for advanced features.
