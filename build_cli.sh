#!/bin/bash
# Build script for creating standalone QA-App CLI executable

set -e

echo "Building QA-App CLI executable with PyInstaller..."

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Activate virtual environment (use explicit PATH for subprocess compatibility)
source venv/bin/activate
export PATH="$SCRIPT_DIR/venv/bin:$PATH"

# Clean previous builds
rm -rf build dist

# Build the executable
python -m PyInstaller qa_app_cli.spec --clean

# Copy executable to a known location for Tauri to bundle
mkdir -p gui/src-tauri/bin
cp dist/qa_app_cli gui/src-tauri/bin/qa_app_cli

echo "✓ Build complete! Executable at: gui/src-tauri/bin/qa_app_cli"
echo "File size: $(du -h gui/src-tauri/bin/qa_app_cli | cut -f1)"
