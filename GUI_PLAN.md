# GUI Plan for XLIFF Regex Tool

## Research & Inspiration

### XLIFF Editors (Open Source)

**Best Examples:**

1. **[XLIFF Manager](https://github.com/rmraya/XLIFFManager)** by Maxprograms
   - Most actively maintained (last update Dec 2024)
   - Cross-platform (Electron-based)
   - Table view med source/target
   - Support for XLIFF 1.2, 2.0, 2.1, 2.2
   - **Vi kan se på dette som hovedinspirasjonen!**

2. **[Ocelot](https://github.com/vistatec/ocelot)** by VistaTEC
   - Open source workbench
   - Segment-based view
   - Color-coding av status
   - Post-editing fokus

3. **[Open Language Tools XLIFF Editor](https://en.wikipedia.org/wiki/Open_Language_Tools)**
   - Java-based
   - Dual-pane source/target view
   - Filter support

4. **[Free Online XLIFF Editor](https://mrmadhav.github.io/xliff-editor/)**
   - Web-based, open source
   - Enkel og ren UI
   - God for inspirasjon til layout

### Regex GUI Tools

**Best Examples:**

1. **[RegExr](https://regexr.com/)** - Online
   - Clean UI med pattern field, test text, og results
   - Live preview av matches
   - Explanation av regex
   - **Perfekt for regex-delen av UI**

2. **[regexxer](https://regexxer.sourceforge.net/)**
   - Desktop GUI search/replace tool
   - Perl-style regex
   - Preview before replace

3. **[FAR (Find And Replace)](https://findandreplace.sourceforge.net/)**
   - Multi-line regex support
   - Automatic backup
   - Bulk operations
   - **God inspirasjon for batch-funksjonalitet**

4. **[PyRex](https://github.com/user0706/PyRex)**
   - Python GUI regex tool
   - Offline alternative til regex101
   - God referanse for Python-basert regex GUI

### React Table Components (for Electron/Tauri)

**Best Options:**

1. **[TanStack Table (React Table)](https://react-table.tanstack.com/docs/examples/editable-data)**
   - Most popular, headless UI
   - Editable cells support
   - Sorting, filtering, pagination
   - **Anbefalt for hovedtabellen**

2. **[Material React Table](https://www.material-react-table.com/docs/guides/editing)**
   - 5 editing modes (modal, inline row, cell-by-cell, always-on, custom)
   - Double-click to edit
   - Professional look

3. **[PrimeReact DataTable](https://primereact.org/datatable/)**
   - Cell editing with `editMode="cell"`
   - onCellEditComplete callback
   - Comprehensive features

4. **[Mantine React Table](https://www.mantine-react-table.com/docs/guides/editing)**
   - Modern design
   - 4 editing modes
   - Good TypeScript support

## Proposed GUI Architecture

### Technology Stack

**Recommendation: Tauri + React + TypeScript**

**Why Tauri over Electron:**
- ✅ Mye mindre bundle size (2-5 MB vs 40-100 MB)
- ✅ Raskere startup
- ✅ Lavere memory footprint
- ✅ Rust backend = perfekt for Python integration
- ✅ Native system integration
- ✅ Automatic updater built-in
- ✅ Open source med aktiv community

**Frontend Stack:**
- React 18+ (for UI)
- TypeScript (type safety)
- TanStack Table (for editable table)
- Tailwind CSS (for styling)
- Zustand eller Jotai (state management - lettere enn Redux)

**Backend Integration:**
- Python backend vi allerede har laget
- Tauri commands kaller Python CLI via subprocess
- Alternativt: Expose Python functions via PyO3 (Rust bindings)

### GUI Layout Design

```
┌─────────────────────────────────────────────────────────────────┐
│  XLIFF Regex Tool                                    [- □ ×]    │
├─────────────────────────────────────────────────────────────────┤
│  File  Edit  Patterns  Tools  Help                              │
├─────────────────────────────────────────────────────────────────┤
│  📁 Open XLIFF    💾 Save    ↶ Undo    ↷ Redo    📊 Stats      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─ Search & Replace ──────────────────────────────────────┐   │
│  │                                                           │   │
│  │  Find:    [________________________] [×] Regex  [×] Case │   │
│  │  Replace: [________________________]                      │   │
│  │                                                           │   │
│  │  📚 Pattern Library ▼  [Normalize Spaces      ▼] Apply  │   │
│  │  💾 Save current search   🔍 Preview   ✓ Replace All     │   │
│  │                                                           │   │
│  │  Matches: 15 in 8 segments                               │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─ Translation Units ──────────────────────────────────────┐   │
│  │ ID  │ Source               │ Target               │ Match│   │
│  ├─────┼──────────────────────┼──────────────────────┼──────┤   │
│  │ 1   │ Hello world          │ Hallo verden         │      │   │
│  │ 2   │ This is  a test      │ Dette er  en test    │  ✓   │   │
│  │     │     ^^^ double space │      ^^^ highlight   │      │   │
│  │ 3   │ Email: test@test.com │ E-post: test@test.no │  ✓   │   │
│  │ 4   │ Multiple    spaces   │ Flere    mellomrom   │  ✓   │   │
│  │ ...                                                       │   │
│  └───────────────────────────────────────────────────────────┘   │
│  < 1 2 3 ... 10 >                        Showing 1-10 of 100    │
│                                                                  │
│  ┌─ Edit Selected Segment ──────────────────────────────────┐   │
│  │ Segment ID: 2                                             │   │
│  │                                                           │   │
│  │ Source:  [This is  a test                            ]   │   │
│  │ Target:  [Dette er  en test                          ]   │   │
│  │                                                           │   │
│  │          [Cancel]  [Apply Changes]                       │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Status: 100 segments | 85 translated | 15 matches found       │
└─────────────────────────────────────────────────────────────────┘
```

## Features Breakdown

### Core Features (MVP)

1. **File Management**
   - Open XLIFF files (drag & drop support)
   - Save / Save As
   - Auto-save option
   - Recent files list

2. **Table View**
   - Source/Target columns
   - Editable cells (double-click)
   - Row selection
   - Highlighting av matches
   - Pagination (10/25/50/100 per page)
   - Column resizing
   - Freeze header on scroll

3. **Search & Replace**
   - Find field med regex toggle
   - Replace field
   - Case sensitive toggle
   - Preview matches before replace
   - Replace one / Replace all
   - Navigation between matches (Next/Previous)
   - Match counter

4. **Pattern Library**
   - Dropdown med saved patterns
   - Quick apply
   - Save current search
   - Manage patterns (add/edit/delete)
   - Category filtering

5. **Edit Panel**
   - Edit selected segment
   - Preserve tags visually
   - Undo/Redo per segment
   - Validation (e.g., tag consistency)

### Advanced Features (Phase 2)

6. **Batch Operations**
   - Multiple files at once
   - Apply pattern to all files
   - Progress indicator

7. **QA Checks**
   - Find unmatched tags
   - Find inconsistent translations
   - Find untranslated segments
   - Custom QA rules

8. **Export/Import**
   - Export patterns to JSON
   - Import Xbench checklists
   - Share pattern libraries

9. **Statistics Dashboard**
   - Word count
   - Match/fuzzy/no-match segments
   - Translation progress
   - Pattern usage statistics

10. **Preferences**
    - Theme (light/dark)
    - Font size
    - Auto-backup settings
    - Default pattern library location

## Implementation Plan

### Phase 1: Setup & Basic UI (Week 1-2)

1. Setup Tauri project with React + TypeScript
2. Create basic layout (header, toolbar, main area)
3. Implement file open dialog
4. Basic table view (read-only)
5. Parse XLIFF using existing Python backend

### Phase 2: Search & Replace (Week 3-4)

1. Search field med regex toggle
2. Highlight matches i table
3. Replace functionality
4. Preview before replace
5. Integrate with Python regex engine

### Phase 3: Pattern Library (Week 5)

1. Pattern library dropdown
2. Load built-in patterns from Python backend
3. Apply pattern button
4. Save current search dialog
5. Manage patterns dialog

### Phase 4: Edit & Save (Week 6)

1. Editable cells
2. Edit panel for selected segment
3. Tag preservation
4. Save functionality
5. Backup creation

### Phase 5: Polish & Testing (Week 7-8)

1. Error handling
2. Loading states
3. Keyboard shortcuts
4. Testing
5. Documentation

## Technical Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Tauri Frontend                       │
│                   (React + TypeScript)                  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Components:                                      │  │
│  │  - FileManager                                    │  │
│  │  - SearchBar                                      │  │
│  │  - TranslationTable (TanStack Table)             │  │
│  │  - EditPanel                                      │  │
│  │  - PatternLibrary                                 │  │
│  └──────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────┐  │
│  │  State Management (Zustand):                     │  │
│  │  - xliffStore (file data, segments)              │  │
│  │  - searchStore (pattern, matches)                │  │
│  │  - patternStore (library, saved patterns)        │  │
│  └──────────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────────┘
                       │ Tauri Commands
                       ▼
┌─────────────────────────────────────────────────────────┐
│                   Tauri Backend                         │
│                       (Rust)                            │
│  ┌──────────────────────────────────────────────────┐  │
│  │  Commands:                                        │  │
│  │  - open_xliff(path)                              │  │
│  │  - save_xliff(path, data)                        │  │
│  │  - find_matches(pattern, flags)                  │  │
│  │  - replace_all(pattern, replacement)             │  │
│  │  - get_patterns()                                │  │
│  │  - save_pattern(pattern)                         │  │
│  └──────────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────────┘
                       │ Python CLI calls
                       ▼
┌─────────────────────────────────────────────────────────┐
│                  Python Backend                         │
│                  (Existing codebase)                    │
│  - xliff_parser.py                                      │
│  - regex_processor.py                                   │
│  - pattern_library.py                                   │
│  - backup_manager.py                                    │
└─────────────────────────────────────────────────────────┘
```

## Code Reuse Strategy

**Maximum reuse av existing Python backend:**

1. **Keep Python CLI as-is**
   - All logic stays in Python
   - GUI calls Python via subprocess
   - No need to rewrite regex logic

2. **Tauri calls Python:**
   ```rust
   #[tauri::command]
   fn find_matches(file_path: String, pattern: String) -> Result<String, String> {
       let output = Command::new("python")
           .arg("src/cli.py")
           .arg("find")
           .arg(&file_path)
           .arg(&pattern)
           .output()?;

       Ok(String::from_utf8_lossy(&output.stdout).to_string())
   }
   ```

3. **Alternative: PyO3 bindings**
   - For bedre performance
   - Direct Python function calls fra Rust
   - Kan gjøres i Phase 2 hvis nødvendig

4. **Data format: JSON**
   - Python outputs JSON
   - Rust parses JSON
   - React consumes JSON
   - Enkelt å utvide senere

## Next Steps

1. ✅ Setup Tauri development environment
2. ✅ Create React project with TypeScript
3. ✅ Setup Python CLI as submodule/dependency
4. ✅ Create basic file open dialog
5. ✅ Parse XLIFF and display in table

**For å begynne:**
```bash
# Install Tauri CLI
cargo install tauri-cli

# Create new Tauri project
npm create tauri-app

# Choose:
# - Package manager: npm
# - UI template: React
# - Variant: TypeScript
```

## Resources

### XLIFF Editors:
- [XLIFF Manager](https://github.com/rmraya/XLIFFManager)
- [Ocelot](https://github.com/vistatec/ocelot)
- [XLIFF Editor Online](https://mrmadhav.github.io/xliff-editor/)

### Regex Tools:
- [RegExr](https://regexr.com/)
- [FAR (Find And Replace)](https://findandreplace.sourceforge.net/)
- [PyRex](https://github.com/user0706/PyRex)

### React Components:
- [TanStack Table](https://react-table.tanstack.com/docs/examples/editable-data)
- [Material React Table](https://www.material-react-table.com/docs/guides/editing)
- [PrimeReact DataTable](https://primereact.org/datatable/)

### Tauri Resources:
- [Tauri Documentation](https://tauri.app/)
- [Tauri + React Guide](https://tauri.app/v1/guides/getting-started/setup/react)
