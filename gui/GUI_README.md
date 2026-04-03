# XLIFF Regex Tool - GUI

Desktop GUI for XLIFF Regex Tool built with Tauri + React + TypeScript.

## Features

- Open XLIFF files (.xliff, .xlf, .mxliff, .mqxliff, .sdlxliff)
- View translation units in a table
- Display statistics (total units, translated, untranslated)
- Integration with Python backend for parsing

## Development

### Prerequisites

- Node.js (v18+)
- Rust and Cargo
- Python 3.8+ with dependencies installed

### Install Dependencies

```bash
npm install
```

### Run Development Server

```bash
npm run tauri dev
```

This will:
1. Start Vite dev server on http://localhost:1420
2. Compile Rust backend
3. Open the desktop application window

### Build for Production

```bash
npm run tauri build
```

## Architecture

### Frontend (React + TypeScript)
- `src/App.tsx` - Main application component
- `src/App.css` - Styling
- File dialog integration via `@tauri-apps/plugin-dialog`

### Backend (Rust/Tauri)
- `src-tauri/src/lib.rs` - Tauri commands
- `src-tauri/src/main.rs` - Application entry point
- `open_xliff` command: Calls Python CLI to parse XLIFF files

### Python Integration
The Rust backend calls the Python CLI:
```rust
python3 ../../src/cli.py stats <file_path> --json
```

This returns JSON with translation units and statistics.

## Project Structure

```
gui/
├── src/               # React frontend
│   ├── App.tsx        # Main component
│   └── App.css        # Styles
├── src-tauri/         # Rust/Tauri backend
│   ├── src/
│   │   ├── lib.rs     # Tauri commands
│   │   └── main.rs    # Entry point
│   ├── Cargo.toml     # Rust dependencies
│   └── tauri.conf.json # Tauri configuration
├── package.json       # Node dependencies
└── vite.config.ts     # Vite configuration
```

## Supported XLIFF Formats

- Standard XLIFF 1.2 (.xliff, .xlf)
- Phrase MXLIFF (.mxliff)
- MemoQ MQXLIFF (.mqxliff)
- Trados SDLXLIFF (.sdlxliff)

## Next Steps

- [ ] Add Find & Replace panel
- [ ] Implement editable table cells
- [ ] Add pattern library dropdown
- [ ] Preview matches before replace
- [ ] Save functionality
- [ ] Undo/Redo
- [ ] Dark mode toggle
