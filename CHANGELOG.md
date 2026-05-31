# Changelog

All notable changes to Nitpick will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-05-31

### Added
- **Punctuation mismatch check** — flags segments where trailing punctuation differs between source and target (e.g. source ends with `?`, target ends with `.`)
- **Double punctuation check** — detects repeated punctuation marks in the target (e.g. `!!`, `..`, `,,`)
- **Quotation mark style check** — flags straight ASCII double quotes `"…"` used in the target where typographic quotes should be used (off by default)
- **Segment length ratio check** — flags targets that are shorter than 25% or longer than 300% of the source length, useful for software UI strings (off by default)
- All four new checks appear under a new **Punctuation** group and a **Segment length** group in the QA checks settings panel

### Fixed
- **Spellcheck false positives on tag-split words** — words separated by inline tags such as `<nl>` or `<br>` were concatenated (e.g. `flerepasienter` instead of `flere pasienter`) and flagged as misspelled. Inline tags now insert a word boundary so each side is checked independently
- **Regex library path** — the regex library (`library.xml`) was stored under `~/.xliff-regex-tool/` (the old app name). It is now stored under `~/.nitpick/library.xml`. Existing libraries are migrated automatically on first launch
- **QA profile path inconsistency** — saved/imported QA profiles were written to the project `samples/` folder in dev mode but `~/.nitpick/samples/` in production, making dev-created profiles invisible in the production build. Both modes now always use `~/.nitpick/samples/`

### Changed
- **Faster startup in production builds** — switched PyInstaller from `--onefile` to `--onedir` mode. The binary no longer extracts itself to a tmp directory on every invocation, reducing per-call startup time from ~1–2 s to ~100–200 ms

## [1.0.0] - 2026-05-22

### Added
- Spellcheck panel with Norwegian Bokmål support and custom word lists
- Terminology check against custom term lists
- DOCX bilingual table import and export (Phrase-style tables)
- XTM match quality support via alt-trans and state-qualifier
- New app icon

### Changed
- App renamed from "XLIFF RegEx Tool" to "Nitpick"
- First public release

## [0.5.1] - 2026-03-24

### Fixed
- Critical bug: manual segment edits were not saved to disk — segment IDs sent to the backend were sequential display numbers instead of the actual XLIFF/TMX IDs, so no edits ever matched

## [0.5.0] - 2026-03-04

### Added
- TMX file format support — open, edit, and save TMX translation memories using the same workflow as XLIFF
- Language picker dialog for TMX files with multiple target languages
- Import batch checks from XML file directly in the Batch Check profile editor

## [0.4.5] - 2026-02-17

### Added
- Added various weird shit

## [0.4.4] - 2026-02-11

### Added
- **TMS Integration** - Open segments directly in Translation Management Systems
  - **Lingotek**: Click "Open in Lingotek" to jump directly to segment in Lingotek workbench
  - **Phrase/Memsource**: Click "Open in Phrase" to open segment in Phrase web editor
  - Auto-copy edited text to clipboard when opening TMS (configurable in Settings)
  - Toast notification confirms text is copied and ready to paste
  - Settings option to enable/disable auto-copy functionality
  - Seamless workflow: Edit in app → Click button → Paste in TMS → Save

### Changed
- **Update check messages** - Improved clarity and language
  - "No Updates Available" instead of error message when already on latest version
  - Clear distinction between "no updates" vs actual errors
  - All messages now in English for consistency

## [0.4.3] - 2026-02-02

### Fixed
- **Escaped HTML entities in tag protection** - Fixed critical bug where "Ignore Tags" didn't properly handle escaped tags
  - Frontend `getTagPattern()` now correctly matches single-escaped (`&lt;tag&gt;`) and double-escaped (`&amp;lt;tag&amp;gt;`) HTML entities
  - Backend `_extract_text_segments()` pattern was already fixed in 0.4.2, now frontend is synchronized
  - Prevents false matches inside escaped XML/HTML content when searching with tag protection enabled
  - Critical fix for MXLIFF files with heavily escaped tag structures

## [0.4.2] - 2026-01-28

### Changed
- **Standalone distribution** - Application now bundles Python CLI as a compiled executable
  - No longer requires Python installation on user's system
  - Uses PyInstaller to create self-contained 14MB executable
  - Includes all dependencies (lxml, regex) bundled in
  - Significantly improves portability and ease of distribution
  - Development mode still uses Python scripts for faster iteration

### Fixed
- **TU display in batch check** - Translation unit numbers now show as readable integers
  - MXLIFF format IDs (e.g., `3xAlx56JlIZVmpmq_dc9:255`) now display as "256"
  - Automatic conversion from 0-indexed to 1-indexed display format
- **Replacement preview in batch check** - Preview now shows actual replacement values
  - Previously showed template like `$1 $2`, now shows computed result like "000 eur"
  - Applies regex replacement to matched text to generate accurate preview
  - Helps verify replacements before applying them
- **Ignore tags with escaped HTML entities** - Fixed "Protect Tags" to properly ignore escaped tags
  - Now correctly ignores `&lt;tag&gt;` (single-escaped) and `&amp;lt;tag&amp;gt;` (double-escaped)
  - Prevents matches inside escaped XML/HTML content in complex XLIFF files
  - Handles HTML entities (`&quot;`, `&amp;`, etc.) within escaped tags
  - Particularly important for memoQ MQXLIFF files with heavily nested tag structures

## [0.4.1] - 2026-01-14

### Fixed
- **Batch replace capture groups** - Fixed replacement strings with capture groups (e.g., `$1`, `$2`)
  - Batch replace now correctly expands capture groups instead of replacing with literal `$1`
  - Conversion between JavaScript-style (`$1`) and Python-style (`\1`) backreferences
  - Regular search & replace in main window continues to work as before
- **Batch check "Select All"** - Fixed selection logic for batch check results
  - "Select All" now correctly selects all items instead of only a subset
  - Fixed index mismatch between grouped rendering and selection logic
- **Regex library auto-scroll** - Edit form now auto-scrolls to top when clicking edit button
  - Smooth scroll animation to bring edit form into view
  - No more manual scrolling needed after clicking the pencil icon

### Changed
- **Batch check button clarity** - Renamed "Replace Selected" to "Replace All"
  - Button now accurately reflects that it applies all fixes from the profile
  - Removed confusing selection count from button text
  - Updated tooltip to explain functionality
- **Backup file location** - Backups now saved next to original file instead of in hidden folder
  - Format: `originalname_backup_YYYYMMDD_HHMMSS.xlf`
  - Easier to find and manage backups
  - Old `.backups` folder format still supported for backwards compatibility

## [0.4.0] - 2026-01-13

### Added
- **Dual search functionality** - Search in both source and target simultaneously with separate patterns
  - When "Both" is selected, two search fields appear (one for source, one for target)
  - Results show only segments where BOTH patterns match (AND logic)
  - Perfect for quality checks: find segments where source contains X but target doesn't contain Y
  - Use cases:
    - Product names: Source has "PRODUCTNAME", target missing it: `^((?!PRODUCTNAME).)*$`
    - Terminology validation: Source has "software", target doesn't have "programvare"
    - Variable consistency: Both source and target must contain `{count}`
    - Missing translations: Source non-empty, target empty
  - Works with regex, case sensitivity, live search, and tag protection
  - Each field has independent regex validation

### Improved
- **ICU auto-fix functionality** - Significant improvements to automatic error correction
  - Fix button now works correctly for segments with multiple ICU errors
  - Fixes apply immediately to the editor without needing to close/reopen the segment
  - ICU keyword fixes (e.g., "flertall" → "plural") now work even when variable names differ between source and target
  - All Fix buttons are now consistently aligned in the error list
  - Preview of what each fix will do is shown below the Fix button

### Fixed
- **Batch replace dialog issues** - Fixed confirm dialog not closing properly
  - Replaced browser `confirm()` and `alert()` with Tauri native dialogs
  - Dialogs now close correctly when clicking OK or Cancel
  - Better UX with native OS dialogs including titles and icons
  - Applied to batch replace confirmation and ICU auto-fix notifications

## [0.3.0] - 2026-01-09

### Added
- **Automatic ICU error correction** - One-click fix for common ICU syntax errors
  - Fix button appears next to each ICU error that can be auto-corrected
  - Automatically corrects ICU keywords (e.g., "flertall" → "plural", "velg" → "select")
  - Automatically corrects category keywords (e.g., "en" → "one", "andre" → "other")
  - Automatically adds missing braces ({ or })
  - Automatically inserts missing "offset:" in plural expressions
  - Supports Norwegian and other common translations of ICU keywords

### Changed
- Renamed all "QA" terminology to "Batch Checks" for clarity
  - "QA Profiles" → "Batch Check Profiles"
  - "QA Batch Checks" → "Batch Checks"
  - Menu items and UI text updated throughout the application
- Updated menu shortcut label (Cmd+P) to "Batch Check Profiles"

## [0.2.0] - 2025-12-29

### Added
- Comprehensive tag protection system for XLIFF files
  - Search and replace operations now correctly ignore all tags and their content
  - Supports XML tags (`<bpt>`, `<ept>`, `<ph>`, `<it>`, `<g>`, etc.)
  - Supports escaped XML within tags (e.g., `<bpt>&lt;uf ufcatid="24"&gt;</bpt>`)
  - Supports placeholders: curly braces `{0}`, square brackets `[1]`, percent formats `%s`
  - Supports HTML entities: `&nbsp;`, `&lt;`, `&gt;`, etc.
- Skip to main content link for improved keyboard navigation
- ARIA roles and labels for better screen reader support
- Search results announcements with live regions
- Loading state announcements for async operations
- Form label associations (htmlFor attributes) for all input fields
- Focus trap in modal dialogs for better keyboard accessibility

### Changed
- **Major performance improvement**: Removed tag styling for faster table rendering
- Improved tag detection regex to match paired tags with all content
- Updated User Guide modal styling for better dark mode compatibility
- Enhanced CSS performance with `contain` properties and `will-change` hints

### Fixed
- Editor panel now has horizontal scrollbar when content is too wide
- Long tags with no spaces now break properly instead of extending beyond viewport
- Delete functionality for regex library entries now persists correctly
- Delete functionality for QA profiles now persists correctly
- All form labels now properly associated with their inputs
- Focus indicators now meet WCAG 2.1 AA standards (2px solid outline)
- Color contrast improved to meet WCAG 2.1 AA standards (4.5:1 ratio)
- Error messages now announced to screen readers

### Accessibility Improvements (WCAG 2.1 AA)
- Fixed all missing focus indicators (replaced `outline: none` with proper 2px outlines)
- Added aria-label to all icon-only buttons (15+ buttons)
- Added ARIA attributes to all modal dialogs (`role="dialog"`, `aria-modal="true"`, `aria-labelledby`)
- Improved text color contrast ratios (4.5:1 for normal text)
- Added `role="alert"` to error messages
- Added `role="status"` to loading states and search results
- Added `role="table"`, `role="row"`, `role="cell"` to segment table
- Added `lang="en"` attribute to HTML document
- All modals now trap keyboard focus for better navigation

## [0.1.0] - 2025-12-XX

### Initial Release
- Basic XLIFF file editing functionality
- Regex search and replace
- Support for multiple XLIFF formats (XLIFF 1.2, MXLIFF, MQXLIFF, SDLXLIFF)
- Regex pattern library
- QA batch checks with profiles
- ICU message format validation
- Dark mode support
- Keyboard shortcuts
- Hidden characters display
- Segment editing panel
