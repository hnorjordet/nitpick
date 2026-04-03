#!/bin/bash
# Script to clear Python cache and restart dev mode

echo "Clearing Python cache..."
find src -name "*.pyc" -delete
find src -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true

echo "✓ Cache cleared"
echo ""
echo "Now restart the app manually:"
echo "1. Stop the current dev server (Ctrl+C if running)"
echo "2. cd gui"
echo "3. npm run tauri dev"
