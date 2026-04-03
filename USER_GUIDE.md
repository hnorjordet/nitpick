# XLIFF RegEx Tool - User Guide

**Version:** 0.1.0 (Beta)
**Author:** Håvard Nørjordet

> **⚠️ Beta Software Notice**
> This is beta software shared between colleagues for testing. While the tool is functional and has been tested with various XLIFF formats, some quirks remain (especially with SDLXLIFF files). Feedback is welcome! Report issues to Håvard.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Supported File Formats](#supported-file-formats)
3. [Interface Guide](#interface-guide)
4. [Search & Replace](#search--replace)
5. [Regex Guide](#regex-guide)
6. [Pattern Library](#pattern-library)
7. [QA Checks](#qa-checks)
8. [Keyboard Shortcuts](#keyboard-shortcuts)
9. [Known Issues & Limitations](#known-issues--limitations)
10. [Troubleshooting](#troubleshooting)
11. [FAQ](#faq)

---

## Quick Start

### Opening Your First XLIFF File

There are two ways to open an XLIFF file:

1. **Drag and Drop**: Simply drag an XLIFF file from Finder onto the application window
2. **File Picker**: Click **File → Open XLIFF** in the menu bar (or press `Cmd+O`)

Supported file extensions: `.xliff`, `.xlf`, `.mxliff`, `.mqxliff`, `.sdlxliff`

### Basic Workflow

1. **Open file**: Use File → Open or drag-and-drop
2. **View segments**: Browse through the translation units in the table
3. **Search**: Enter a search pattern in the "Search for" field
4. **Replace**: Enter replacement text in the "Replace with" field
5. **Preview**: Click "Search" to highlight matches in yellow
6. **Apply**: Click "Replace in All Matches" to apply changes
7. **Save**: Use File → Save (or `Cmd+S`) to save your changes

### First-Time User Tips

- **Dark Mode**: Toggle with the moon icon (🌙) in the top-right toolbar
- **Hidden Characters**: Click the paragraph icon (¶) to show/hide spaces, tabs, and line breaks
- **Jump to Segment**: Use the "Jump to segment" field to quickly navigate to a specific segment number
- **Segment Editing**: Click on any row to open the editor panel at the bottom
- **Navigation**: Use `Cmd+↑` to jump to the first segment, `Cmd+↓` for the last segment

---

## Supported File Formats

### XLIFF 1.2/2.0 (Standard)

**Status:** ✅ Fully supported
**Extensions:** `.xliff`, `.xlf`

Standard XLIFF files work perfectly. All translation units are parsed correctly, and tags are preserved during find/replace operations.

**What works:**
- All `<trans-unit>` elements parsed
- Source and target segments extracted
- Tags preserved during editing
- Full regex support

**Limitations:** None known

---

### MQXLIFF (memoQ)

**Status:** ✅ Fully tested and working
**Extension:** `.mqxliff`

MemoQ XLIFF files are fully supported and have been extensively tested.

**What works:**
- All translation units parsed correctly
- Segment IDs displayed as sequential numbers (1, 2, 3...)
- Tags preserved
- Full regex support

**Limitations:** None known

---

### MXLIFF (Phrase)

**Status:** ✅ Working
**Extension:** `.mxliff`

Phrase MXLIFF files work well. Segment numbers are automatically converted from 0-indexed to 1-indexed for display.

**What works:**
- Translation units parsed correctly
- Segment IDs displayed starting from 1 (not 0)
- Tags preserved

**Limitations:** None known

---

### SDLXLIFF (SDL Trados Studio)

**Status:** ⚠️ Beta - Under Investigation
**Extension:** `.sdlxliff`

SDLXLIFF files from SDL Trados Studio are supported, but with some caveats.

**What works:**
- Translation units extracted from `<seg-source>` elements
- Wrapper tags (`<mrk>`, `<g>`) are stripped for display but preserved in the file
- SDL metadata displayed (match percentage, date, origin)
- Sequential segment numbering (1, 2, 3...)

**Known Issues:**
- **Segmentation differences**: The number of segments shown may differ from what you see in SDL Trados Studio or memoQ. This is being investigated with a Studio user.
  - Example: A file might show 60 segments in this tool vs. 120 in memoQ
  - Reason: Different tools segment files differently. Empty/structural segments are filtered out.
- **Verification needed**: If segment counts differ significantly from your CAT tool, please verify critical segments manually

**What to do if segments look different:**
1. Open the file in both this tool and your CAT tool
2. Check a few key segments to ensure content matches
3. If major discrepancies exist, report to Håvard with sample file

**Tags:** SDLXLIFF uses complex tag structures (`<x id="..."/>`, `<mrk mtype="seg">`, etc.). These are automatically hidden in the UI but preserved during editing to prevent corruption.

---

## Interface Guide

### Main Window Layout

```
┌─────────────────────────────────────────────────────────┐
│ File  View  Insert  Help                    ¶  🌙  ⚙️  │  ← Menu bar
├─────────────────────────────────────────────────────────┤
│ Statistics:  Total: 60  Translated: 45  Untrans: 15    │  ← Stats bar
├─────────────────────────────────────────────────────────┤
│ Search for: [regex pattern]         [Search]           │
│ Replace with: [replacement]  [Replace in All Matches]  │  ← Search panel
│ ☑ Use RegEx  ☑ Case Sensitive  ☑ Protect Tags          │
├─────────────────────────────────────────────────────────┤
│ Jump: [42] [Go]     Search in: ○ Target ○ Source ○ Both│  ← Navigation
├─────────────────────────────────────────────────────────┤
│ #  │ Source                    │ Target                 │
│────┼───────────────────────────┼────────────────────────│  ← Segment table
│ 1  │ Hello world               │ Hei verden             │
│ 2  │ Welcome to the app        │ Velkommen til appen    │
│ ...│                            │                        │
├─────────────────────────────────────────────────────────┤
│ Editor Panel (appears when clicking a segment)         │  ← Editor (bottom)
│ Segment 1                                               │
│ Source: Hello world                                     │
│ Target: [Hei verden_________]  [Save] [Cancel]         │
└─────────────────────────────────────────────────────────┘
```

### Toolbar Icons

- **¶ (Paragraph)**: Toggle hidden characters (spaces, tabs, line breaks)
- **🌙 (Moon)**: Toggle dark mode
- **⚙️ (Gear)**: Open settings

### Statistics Bar

Shows file-level statistics:
- **Total**: Total number of translation units
- **Translated**: Units with target text
- **Untranslated**: Units without target text

### Search Panel

- **Search for**: Enter your search pattern (supports regex)
- **Replace with**: Enter replacement text (supports backreferences like `\1`, `\2`)
- **Search button**: Highlights all matches in the table (yellow background)
- **Replace in All Matches**: Applies replacement to all matched segments
- **Use RegEx checkbox**: Enable/disable regex mode
- **Case Sensitive checkbox**: Match case exactly
- **Protect Tags checkbox**: Prevent regex from matching inside XML tags

### Segment Table

Displays all translation units with:
- **#**: Sequential segment number (1, 2, 3...)
- **Source**: Source language text
- **Target**: Target language text (editable)
- **Highlighting**:
  - Yellow background = search match
  - Blue background = edited segment (unsaved changes)
  - Red badge (⚠️) = ICU syntax error detected

### Editor Panel

Appears at the bottom when you click a segment. Shows:
- Segment number and full ID (hover for tooltip)
- Source text (read-only)
- Target text (editable textarea)
- **Save** button: Save changes to this segment
- **Cancel** button: Discard changes and close editor
- Press `Escape` to close editor without saving

### Metadata Display (SDLXLIFF only)

For SDLXLIFF files, additional metadata is shown below target text:
- **Match**: Translation memory match percentage
- **Date**: When the segment was last modified
- **Origin**: Where the translation came from (TM, MT, manual, etc.)

---

## Search & Replace

### Basic Search

1. Enter text in "Search for" field
2. Click "Search" button
3. Matches are highlighted in yellow in the table

**Options:**
- **Search in**: Choose Target (default), Source, or Both
- **Case Sensitive**: Match exact case
- **Use RegEx**: Enable regular expressions (see Regex Guide below)

### Basic Replace

1. Enter search pattern in "Search for"
2. Enter replacement in "Replace with"
3. Click "Search" to preview matches
4. Click "Replace in All Matches" to apply changes

**Undo:** Use Edit → Undo Changes to revert all unsaved edits

### Tag Protection

When **Protect Tags** is enabled (recommended), the regex engine ensures that:
- XML tags are not modified by search/replace
- Tags are extracted before regex operation
- Tags are reinserted after replacement
- Tag structure remains valid

**Example:**
- Text: `Hello <x id="1"/> world`
- Pattern: `Hello.*world`
- Without protection: Might match and corrupt the tag
- With protection: Only matches text segments, tags preserved

---

## Regex Guide

### What is RegEx?

Regular expressions (regex) are powerful patterns for matching and manipulating text. They let you find complex patterns that simple text search cannot handle.

### Basic Patterns

| Pattern | Description | Example |
|---------|-------------|---------|
| `hello` | Literal text | Matches "hello" |
| `.` | Any single character | `h.llo` matches "hello", "hallo" |
| `*` | Zero or more | `hel*o` matches "heo", "helo", "hello" |
| `+` | One or more | `hel+o` matches "helo", "hello" (not "heo") |
| `?` | Zero or one | `colou?r` matches "color", "colour" |
| `\d` | Any digit | `\d+` matches "123" |
| `\s` | Whitespace | `\s+` matches spaces, tabs, newlines |
| `\w` | Word character | `\w+` matches "hello" |
| `^` | Start of string | `^Hello` matches "Hello world" |
| `$` | End of string | `world$` matches "Hello world" |
| `[abc]` | Any of a, b, or c | `[aeiou]` matches any vowel |
| `[^abc]` | Not a, b, or c | `[^0-9]` matches non-digits |
| `\b` | Word boundary | `\bthe\b` matches "the" but not "there" |

### Quantifiers

| Pattern | Description | Example |
|---------|-------------|---------|
| `{n}` | Exactly n times | `\d{4}` matches "2023" |
| `{n,}` | n or more times | `\d{2,}` matches "12", "123", "1234" |
| `{n,m}` | Between n and m times | `\d{2,4}` matches "12", "123", "1234" |

### Capture Groups & Backreferences

Capture groups let you extract parts of a match and reuse them in replacements.

**Syntax:**
- `(pattern)` - Capture group
- `\1`, `\2`, etc. - Backreference in replacement

**Example 1: Swap words**
```
Search:    (\w+)\s+(\w+)
Replace:   \2 \1

Input:     "hello world"
Output:    "world hello"
```

**Example 2: Reformat dates**
```
Search:    (\d{2})\.(\d{2})\.(\d{4})
Replace:   \3-\2-\1

Input:     "24.12.2023"
Output:    "2023-12-24"
```

### Common Translation Use Cases

#### Find Inconsistent Terminology

Search for variations of a term:
```regex
\b(organisation|organization)\b
```
Replace all with consistent spelling.

#### Find Double Spaces

```regex
\s{2,}
```
Replace with single space: ` `

#### Find Leading/Trailing Spaces

```regex
^\s+|\s+$
```
Replace with empty string (delete).

#### Find Numbers with Wrong Formatting

Norwegian thousands separator (space instead of comma):
```regex
\d{1,3}(,\d{3})+
```
Replace: Use backreferences to swap commas with spaces

#### Find Untranslated English Words

If translating to Norwegian, find common English words:
```regex
\b(the|and|or|but|with|from)\b
```

#### Find URLs or Emails

```regex
\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b
```

#### Find Dates

Match DD.MM.YYYY format:
```regex
\b\d{2}\.\d{2}\.\d{4}\b
```

#### Find Time Expressions

Match HH:MM format:
```regex
\b\d{1,2}:\d{2}\b
```

### XLIFF-Specific Tips

**Searching Across Segments:**
The tool searches each segment individually, not across multiple segments. Each regex match is confined to one translation unit.

**Target vs Source:**
- Default: Search in **Target** (translated text)
- Use "Search in: Source" to search original text
- Use "Both" to search in both columns

**Case Sensitivity:**
- Default: Case-insensitive (finds "Hello", "hello", "HELLO")
- Enable "Case Sensitive" to match exact case

### Testing Regex Before Applying

**Important:** Always test your regex on a small sample before running "Replace in All Matches"!

1. Click "Search" to preview matches (yellow highlights)
2. Verify the matches are correct
3. Click on individual segments to see what will be replaced
4. If satisfied, click "Replace in All Matches"
5. Save the file when done

**Undo:** If you make a mistake, use Edit → Undo Changes to revert all unsaved edits.

### Regex Examples Gallery

#### Example 1: Remove Extra Spaces Before Punctuation

```
Search:    \s+([.,!?;:])
Replace:   \1

Before:    "Hello , world !"
After:     "Hello, world!"
```

#### Example 2: Normalize Quotes

```
Search:    "([^"]+)"
Replace:   «\1»

Before:    "Hello world"
After:     «Hello world»
```

#### Example 3: Fix Common Typo

```
Search:    \bteh\b
Replace:   the

Before:    "I saw teh cat"
After:     "I saw the cat"
```

#### Example 4: Add Space After Period

```
Search:    \.(\w)
Replace:   . \1

Before:    "Hello.World"
After:     "Hello. World"
```

#### Example 5: Convert Date Format

```
Search:    (\d{2})\.(\d{2})\.(\d{4})
Replace:   \2/\1/\3

Before:    "24.12.2023"
After:     "12/24/2023"
```

---

## Pattern Library

The tool includes a built-in library of common regex patterns for translation and localization tasks.

### Accessing the Library

1. Click **Insert → Regex Library** (or press `Cmd+L`)
2. Browse patterns by category
3. Click **Use** to insert pattern into search field

### Categories

- **Whitespace**: Multiple spaces, leading/trailing spaces, space before punctuation
- **Punctuation**: Double periods, double commas, misplaced punctuation
- **Typos**: Common typos (teh→the, recieve→receive, etc.)
- **Norwegian**: Norwegian-specific patterns (quotes, dates, numbers)
- **URLs & Emails**: Find email addresses, URLs, domains
- **Tags & Markup**: Find unmatched brackets, parentheses
- **Consistency**: Ensure consistent terminology

### Using a Pattern

1. Open Regex Library
2. Select a pattern (e.g., "Multiple Spaces")
3. Click **Use** button
4. Pattern is inserted into "Search for" field
5. Replacement (if defined) is inserted into "Replace with" field
6. Click "Search" to preview matches

### Managing Patterns

- **Add Pattern**: Click "+ Add Pattern" button
- **Edit Pattern**: Click "Edit" button next to pattern
- **Delete Pattern**: Click "Delete" button
- **Enable/Disable**: Toggle checkbox to activate/deactivate patterns

### Creating Custom Patterns

1. Click "+ Add Pattern"
2. Fill in:
   - **Name**: Short descriptive name
   - **Category**: Choose or create new category
   - **Pattern**: Your regex pattern
   - **Replacement**: What to replace matches with
   - **Description**: Explain what the pattern does
3. Click "Save"

**Example:**
```
Name:         Norwegian Quote Fix
Category:     Norwegian
Pattern:      "([^"]+)"
Replacement:  «\1»
Description:  Replace English quotes with Norwegian guillemets
```

---

## QA Checks

The QA Checks feature lets you run batch quality checks across your entire file using predefined profiles.

### Running QA Checks

1. Click **Insert → QA Checks** (or press `Cmd+K`)
2. Select a QA profile from dropdown
3. Click **Run Checks**
4. Review results in the panel
5. Click on individual results to jump to segment

### QA Profile Structure

QA profiles are XML files stored in `./samples/` directory (configurable in Settings).

**Example profile (`qa-profile.xml`):**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<qa-profile>
  <name>Norwegian QA</name>
  <description>Quality checks for Norwegian translation</description>

  <checks>
    <check>
      <name>Double Spaces</name>
      <pattern>\s{2,}</pattern>
      <severity>warning</severity>
      <category>Whitespace</category>
    </check>

    <check>
      <name>English Word "the"</name>
      <pattern>\bthe\b</pattern>
      <severity>error</severity>
      <category>Untranslated</category>
    </check>
  </checks>
</qa-profile>
```

### Managing QA Profiles

- **Create Profile**: Click "Manage Profiles" → "Create New Profile"
- **Edit Profile**: Click "Manage Profiles" → Select profile → "Edit"
- **Delete Profile**: Click "Manage Profiles" → Select profile → "Delete"

### Profile Editor

The profile editor lets you:
- Set profile name and description
- Add/remove checks
- Configure check severity (error, warning, info)
- Set categories for organization
- Test patterns against sample text

---

## Keyboard Shortcuts

### File Operations

| Shortcut | Action |
|----------|--------|
| `Cmd+O` | Open XLIFF file |
| `Cmd+S` | Save current file |
| `Cmd+W` | Close file |
| `Cmd+Q` | Quit application |

### Editing

| Shortcut | Action |
|----------|--------|
| `Cmd+F` | Focus search field |
| `Cmd+Z` | Undo changes |
| `Escape` | Close editor panel or dialog |

### Navigation

| Shortcut | Action |
|----------|--------|
| `Cmd+↑` | Jump to first segment |
| `Cmd+↓` | Jump to last segment |
| `Cmd+L` | Open Regex Library |
| `Cmd+K` | Open QA Checks |

### View

| Shortcut | Action |
|----------|--------|
| `Cmd+D` | Toggle dark mode |
| `Cmd+H` | Toggle hidden characters |

### Segment Editing

| Shortcut | Action |
|----------|--------|
| Click row | Open editor for that segment |
| `Escape` | Close editor without saving |
| `Cmd+Enter` | Save and close editor |

---

## Known Issues & Limitations

### SDLXLIFF Segmentation

**Issue:** Segment counts may differ from SDL Trados Studio or memoQ.

**Why:** Different CAT tools segment files differently. This tool filters out empty/structural segments that some tools preserve.

**Example:**
- This tool shows: 60 segments
- memoQ shows: 120 segments
- Trados Studio shows: ??? (under investigation)

**What to do:**
1. Manually verify a few key segments match between tools
2. If major content is missing, report to Håvard with sample file
3. For now, cross-check critical segments in your CAT tool after using this tool

**Status:** Under investigation with a Trados Studio user. Awaiting feedback on how Studio displays the same files.

### Tag Visibility

**Issue:** Tags like `<x id="1"/>`, `<bpt>`, `<ept>` are hidden in the interface.

**Why:** This is by design to improve readability. Showing long tag IDs would clutter the UI.

**Future:** Implement CAT-tool-style tag display ([1], [2], etc.) that are non-editable placeholders.

**Workaround:** Tags are preserved in the file structure even though not visible. They will not be corrupted during find/replace if "Protect Tags" is enabled.

### Segment Numbering

**Issue:** Segment IDs shown as sequential 1, 2, 3... but original IDs may be UUIDs or other formats.

**Why:** Simplified numbering for user-friendly display.

**Impact:** None. Original IDs are preserved in the file. Sequential numbers are just for display and navigation.

### Large Files

**Issue:** Files with 10,000+ segments may be slow to load or search.

**Why:** The entire file is loaded into memory for editing.

**Workaround:** Split very large files into smaller chunks if performance is an issue.

### Undo Limitations

**Issue:** Undo only works for unsaved changes. Once you save, undo is no longer available.

**Why:** File backups are created before saving, but in-app undo is session-based.

**Workaround:** Use File → Restore Backup to revert to previous version after saving.

### File Backup Location

**Issue:** Where are backups stored?

**Answer:** Backups are stored in a `.backups/` folder in the same directory as the original file.

**Format:** `filename_YYYYMMDD_HHMMSS.xliff`

**Example:**
```
/path/to/myfile.xliff
/path/to/.backups/myfile_20231224_153045.xliff
```

---

## Troubleshooting

### File Won't Open

**Symptom:** Error message when trying to open XLIFF file.

**Possible Causes:**
1. **Unsupported format**: Check file extension (must be `.xliff`, `.xlf`, `.mxliff`, `.mqxliff`, `.sdlxliff`)
2. **Corrupted file**: XML structure is malformed
3. **Encoding issues**: File is not UTF-8 encoded
4. **Unsupported XLIFF variant**: Rare XLIFF variant not yet supported

**Solutions:**
1. Verify file extension is correct
2. Open file in text editor to check XML structure
3. Convert file to UTF-8 encoding
4. Try exporting a fresh copy from your CAT tool
5. Send sample file to Håvard for investigation

### Replace Not Working as Expected

**Symptom:** Replacement doesn't produce expected results.

**Possible Causes:**
1. **Regex syntax error**: Pattern is invalid
2. **Tag protection**: Tags are blocking matches
3. **Case sensitivity**: Search is case-sensitive but shouldn't be (or vice versa)
4. **Wrong search scope**: Searching in Source instead of Target

**Solutions:**
1. Test regex pattern in online regex tester (e.g., regex101.com)
2. Disable "Protect Tags" if you want to match inside tags (not recommended)
3. Check "Case Sensitive" checkbox setting
4. Verify "Search in" is set to correct scope (Target/Source/Both)

### Regex Errors

**Symptom:** "Invalid regex pattern" error message.

**Common Mistakes:**
- Unescaped special characters: `.`, `*`, `+`, `?`, `[`, `]`, `{`, `}`, `(`, `)`, `|`, `\`
- Unclosed brackets: `[abc` (should be `[abc]`)
- Invalid backreferences: `\3` when only 2 capture groups exist

**Solution:** Check regex syntax. Escape special characters with `\` if using them literally.

**Example:**
```
Wrong: How much does it cost?
Right: How much does it cost\?
```

### Performance Issues with Large Files

**Symptom:** Application is slow when searching or replacing.

**Cause:** File has many segments (5,000+).

**Solutions:**
1. Use more specific regex patterns to reduce matches
2. Search in only Target or Source, not Both
3. Split large files into smaller chunks
4. Close other applications to free up memory

### Save Fails

**Symptom:** Error when trying to save file.

**Possible Causes:**
1. **File permissions**: No write access to file or directory
2. **File is open elsewhere**: Another program has the file locked
3. **Disk full**: No space left on disk

**Solutions:**
1. Check file permissions in Finder
2. Close file in other programs (CAT tool, text editor)
3. Free up disk space

### Backup Not Created

**Symptom:** No backup file in `.backups/` folder.

**Cause:** Backup creation failed due to permissions or disk space.

**Solution:** Check write permissions for the directory.

---

## FAQ

### Why can't I see tags?

Tags like `<x id="1"/>`, `<bx/>`, `<ept>` are intentionally hidden in the UI to improve readability. They clutter the interface and make segments hard to read. However, **tags are fully preserved** in the XML structure and will not be corrupted during editing.

**Future:** Implement CAT-tool-style tag placeholders like `[1]`, `[2]` that are read-only.

### Is my original file safe?

Yes. The tool creates automatic backups in `.backups/` folder before saving any changes. You can restore from backup at any time.

**Best practice:** Keep your original files in version control or separate backup location.

### Can I use this with [my CAT tool]?

The tool is designed to work alongside CAT tools, not replace them. You can:

1. Export XLIFF from your CAT tool
2. Open in XLIFF RegEx Tool
3. Perform batch regex operations
4. Save the file
5. Import back into your CAT tool

**Tested with:**
- memoQ (MQXLIFF) ✅
- SDL Trados Studio (SDLXLIFF) ⚠️ Beta
- Phrase (MXLIFF) ✅

**Note:** Always verify the file opens correctly in your CAT tool after editing. SDLXLIFF support is still being refined.

### What happens if my regex is wrong?

If you run a replace operation with incorrect regex:

1. Changes are only applied in-memory (not saved to disk yet)
2. You can **Undo Changes** (Edit → Undo) to revert
3. If you saved already, you can **Restore Backup**

**Best practice:**
- Test regex on a copy of the file first
- Use "Search" to preview matches before replacing
- Check a few segments manually after replace

### Can I use backreferences?

Yes! Backreferences work in the "Replace with" field.

**Syntax:** `\1`, `\2`, `\3`, etc.

**Example:**
```
Search:    (\d{2})\.(\d{2})\.(\d{4})
Replace:   \3-\2-\1
```

### How do I report a bug?

Contact Håvard directly:
- Provide a description of the issue
- Include steps to reproduce
- Attach sample file if possible (or a simplified/anonymized version)

This is beta software shared between colleagues, not commercial software, so there's no formal support ticket system.

### Does this tool work on Windows or Linux?

Currently the tool is built for macOS only (Apple Silicon / Intel).

**Future:** Windows and Linux builds can be created if there's demand. Let Håvard know if you need this.

### Can I contribute patterns to the library?

Yes! If you create useful regex patterns, share them with Håvard and they can be added to the built-in library for others to use.

### Where are settings stored?

Settings are stored in:
```
~/.xliff-regex-tool/config.json
```

You can manually edit this file if needed.

---

## Tips & Best Practices

### Before Running Replace

1. ✅ **Test your regex** in online regex tester first
2. ✅ **Use "Search"** to preview matches (yellow highlights)
3. ✅ **Check a few segments** manually to ensure matches are correct
4. ✅ **Enable "Protect Tags"** to avoid corrupting XML tags
5. ✅ **Make a backup** of your file (automatic, but verify `.backups/` folder exists)

### After Running Replace

1. ✅ **Review changed segments** (blue highlighting shows edited rows)
2. ✅ **Click through a few segments** to verify changes are correct
3. ✅ **Save the file** (Cmd+S)
4. ✅ **Test in your CAT tool** to ensure file still opens correctly

### Organizing Work

- Create **QA profiles** for recurring checks (e.g., "Norwegian QA", "English QA")
- Build a **pattern library** of your most-used regex patterns
- Use **descriptive names** for patterns (e.g., "Fix Norwegian Quotes" not "Pattern 1")

### SDLXLIFF Files

- **Always verify** in Trados Studio after editing
- **Check segment counts** match expectations
- **Report discrepancies** to Håvard with sample files

---

## Glossary

- **XLIFF**: XML Localization Interchange File Format - standard for translation files
- **Regex**: Regular expression - pattern matching language
- **Trans-unit**: Translation unit - a single translatable segment in XLIFF
- **Source**: Original language text
- **Target**: Translated language text
- **CAT Tool**: Computer-Assisted Translation tool (memoQ, Trados, Phrase, etc.)
- **Backreference**: Reference to a captured group in regex replacement
- **Capture group**: Part of regex pattern enclosed in parentheses `()`

---

## Version History

### 0.1.0 (Beta) - 2024-12-27

**Initial release:**
- XLIFF file support (.xliff, .mxliff, .mqxliff, .sdlxliff)
- Regex search and replace
- Pattern library
- QA batch checks
- Dark mode
- Hidden characters display
- Segment navigation
- Backup/restore functionality

**Known issues:**
- SDLXLIFF segmentation under investigation
- Tags not displayed in UI (preserved in XML)

---

## Credits

**Author:** Håvard Nørjordet
**Built with:** Tauri, React, TypeScript, Rust, Python
**License:** Internal use (not open source)

---

## Feedback & Support

This is beta software shared between colleagues. Feedback is welcome!

**Contact:** Håvard Nørjordet

**What to report:**
- Bugs and crashes
- File format issues (especially SDLXLIFF)
- Feature requests
- Regex patterns to add to library

**What to include:**
- Description of issue
- Steps to reproduce
- Sample file (if applicable)
- Your CAT tool and version

---

**Last updated:** 2024-12-27
