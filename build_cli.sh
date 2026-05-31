#!/bin/bash
# Build script for creating standalone QA-App CLI executable (--onedir mode).
#
# Produces dist/qa_app_cli/ — a folder containing the binary and all shared
# libraries. Tauri bundles the entire folder as a resource, and lib.rs resolves
# the binary as bin/qa_app_cli/qa_app_cli at runtime.

set -e

echo "Building QA-App CLI executable with PyInstaller (--onedir)..."

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Activate virtual environment (use explicit PATH for subprocess compatibility)
source venv/bin/activate
export PATH="$SCRIPT_DIR/venv/bin:$PATH"

# Clean previous builds
rm -rf build dist

# Build the executable (--onedir is defined in the spec file)
python -m PyInstaller qa_app_cli.spec --clean

# Copy the entire output folder to the Tauri bin directory
mkdir -p gui/src-tauri/bin
rm -rf gui/src-tauri/bin/qa_app_cli
cp -r dist/qa_app_cli gui/src-tauri/bin/qa_app_cli

# Also remove any stale copy in the Tauri debug target directory.
# Tauri's build script uses fs::create_dir (not create_dir_all) and will
# fail with "File exists" if the old single-file binary is still there
# when it tries to create the folder for the first time after switching to --onedir.
rm -rf gui/src-tauri/target/debug/bin/qa_app_cli
rm -rf gui/src-tauri/target/release/bin/qa_app_cli

echo "✓ Build complete! Folder at: gui/src-tauri/bin/qa_app_cli/"
echo "Folder size: $(du -sh gui/src-tauri/bin/qa_app_cli | cut -f1)"
echo "Binary: gui/src-tauri/bin/qa_app_cli/qa_app_cli"
