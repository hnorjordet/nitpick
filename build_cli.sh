#!/bin/bash
# Build script for creating standalone XLIFF CLI executable

set -e

echo "Building XLIFF CLI executable with PyInstaller..."

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Activate virtual environment
source venv/bin/activate

# Clean previous builds
rm -rf build dist

# Build the executable
pyinstaller xliff_cli.spec --clean

# Copy executable to a known location for Tauri to bundle
mkdir -p gui/src-tauri/bin
cp dist/xliff_cli gui/src-tauri/bin/xliff_cli

echo "✓ Build complete! Executable at: gui/src-tauri/bin/xliff_cli"
echo "File size: $(du -h gui/src-tauri/bin/xliff_cli | cut -f1)"
