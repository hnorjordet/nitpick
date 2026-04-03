# Building XLIFF RegEx Tool

This guide explains how to build the XLIFF RegEx Tool for distribution.

## Prerequisites

- **Python 3.10+** - Required for development
- **Node.js 18+** - Required for building the frontend
- **Rust** - Required for building the Tauri app (install via [rustup](https://rustup.rs))
- **Xcode Command Line Tools** (macOS) - Required for building

## Setup Development Environment

1. **Clone the repository and navigate to it:**
   ```bash
   cd /path/to/RegEx_tool
   ```

2. **Set up Python virtual environment:**
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

3. **Install Node.js dependencies:**
   ```bash
   cd gui
   npm install
   cd ..
   ```

## Building for Distribution

The application uses PyInstaller to create a standalone Python executable that includes all dependencies (lxml, regex). This means end users don't need to have Python installed.

### Step 1: Build the Python CLI Executable

```bash
./build_cli.sh
```

This script:
- Activates the virtual environment
- Runs PyInstaller to compile `src/cli.py` into a standalone executable
- Copies the executable to `gui/src-tauri/bin/xliff_cli`
- The executable is ~14MB and includes all Python dependencies

### Step 2: Build the Tauri Application

```bash
cd gui
npm run tauri build
```

This will:
- Build the React frontend
- Automatically run `build_cli.sh` (configured in `tauri.conf.json`)
- Bundle the Python CLI executable
- Create the macOS .app and .dmg in `gui/src-tauri/target/release/bundle/`

## Distribution Files

After building, you'll find:

- **DMG Installer**: `gui/src-tauri/target/release/bundle/dmg/XLIFF RegEx Tool_0.4.2_aarch64.dmg`
- **App Bundle**: `gui/src-tauri/target/release/bundle/macos/XLIFF RegEx Tool.app`

## End User Requirements

The distributed .dmg/.app requires:
- **macOS 10.13+** (High Sierra or newer)
- **No Python installation required** - Python is bundled as a compiled executable
- **No additional dependencies** - All required libraries are included

## Development vs Production

- **Development mode**: Uses Python scripts directly from `src/` via the virtual environment
  - Faster iteration, no need to rebuild CLI
  - Started with `npm run tauri dev`

- **Production mode**: Uses the compiled `xliff_cli` executable
  - Standalone, no Python needed
  - All dependencies bundled
  - Created with `npm run tauri build`

## Troubleshooting

### Build fails with "Failed to execute CLI"

Make sure you've run `./build_cli.sh` before building the Tauri app. The build script should run automatically, but you can run it manually if needed.

### PyInstaller errors

If PyInstaller fails to build:
1. Make sure the virtual environment is activated
2. Verify all dependencies are installed: `pip install -r requirements.txt`
3. Check that `xliff_cli.spec` includes all necessary modules

### DMG won't open on other Macs

This is usually a code signing issue. For distribution outside your organization, you'll need:
1. An Apple Developer account ($99/year)
2. A Developer ID certificate
3. Notarization of the app with Apple

## Questions?

Contact: Håvard Nørjordet
