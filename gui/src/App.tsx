import React, { useState, useMemo, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save, ask, message } from '@tauri-apps/plugin-dialog';
import { listen, emit } from '@tauri-apps/api/event';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { openUrl } from '@tauri-apps/plugin-opener';
import { marked } from 'marked';
import "./App.css";
import "./retro-mode.css";
import "./hacker-mode.css";
import { getRetroSoundGenerator } from './retroSound';
import { processSegmentTags, type ProcessedSegment } from './tagUtils';

interface Metadata {
  match_percent?: string;
  match_quality?: string;
  translate?: string;
  approved?: string;
  modified_date?: string;
  modified_by?: string;
  state?: string;
  locked?: string;
  created_date?: string;
  created_by?: string;
  origin?: string;
}

interface TmsMetadata {
  tms_type?: string;
  lingotek_url?: string;
  phrase_url?: string;
}

interface TransUnit {
  id: string;
  segment_number?: number | null;
  source: string;
  target: string;
  metadata?: Metadata | null;
  icu_errors?: string[] | null;
  tms_metadata?: TmsMetadata | null;
}

// Multi-file support types
interface FileEntry {
  fileIndex: number;
  filePath: string;
  fileName: string;
  data: XliffData;
  targetLang: string | null;
}

interface DisplayUnit extends TransUnit {
  globalId: string;       // `${fileIndex}:${id}` - unique across files
  fileIndex: number;
  fileSegmentNumber: number; // 1-based numbering within this file
  fileName: string;
}

interface FileHeaderRow {
  type: 'fileHeader';
  fileIndex: number;
  fileName: string;
  stats: Stats;
}

type DisplayRow = DisplayUnit | FileHeaderRow;

function isFileHeader(row: DisplayRow): row is FileHeaderRow {
  return 'type' in row && row.type === 'fileHeader';
}

interface Stats {
  total_units: number;
  translated: number;
  untranslated: number;
}

interface XliffData {
  trans_units: TransUnit[];
  stats: Stats;
}

interface RegexEntry {
  id: string;
  name: string;
  description: string;
  pattern: string;
  replace: string;
  category: string;
}

interface RegexCategory {
  name: string;
  entries: RegexEntry[];
}

interface RegexLibrary {
  categories: RegexCategory[];
}

// Regex validation function
function validateRegex(pattern: string): { valid: boolean; error?: string } {
  try {
    new RegExp(pattern);
    return { valid: true };
  } catch (e) {
    return { valid: false, error: (e as Error).message };
  }
}

// ICU validation function
function validateICU(source: string, target: string): string[] {
  if (!target) return [];

  const errors: string[] = [];
  const ICU_KEYWORDS = ['plural', 'select', 'selectordinal'];
  const CATEGORY_KEYWORDS = ['zero', 'one', 'two', 'few', 'many', 'other'];

  // Check 1: ICU keywords must be present in exact same form
  for (const keyword of ICU_KEYWORDS) {
    const sourcePattern = new RegExp(`\\{[^}]+,\\s*${keyword}\\b`, 'gi');
    const sourceMatches = source.match(sourcePattern) || [];
    const targetMatches = target.match(sourcePattern) || [];

    if (sourceMatches.length > 0 && targetMatches.length === 0) {
      errors.push(`ICU keyword "${keyword}" is missing or incorrectly translated in target (must remain as "${keyword}")`);
    } else if (sourceMatches.length !== targetMatches.length) {
      errors.push(`ICU keyword "${keyword}" count mismatch (source: ${sourceMatches.length}, target: ${targetMatches.length})`);
    }
  }

  // Check 2: Category keywords not changed
  for (const category of CATEGORY_KEYWORDS) {
    const sourcePattern = new RegExp(`\\b${category}\\s*\\{`, 'g');
    const sourceMatches = source.match(sourcePattern) || [];
    const targetMatches = target.match(sourcePattern) || [];

    if (sourceMatches.length > 0 && targetMatches.length === 0) {
      errors.push(`Category "${category}" is missing or incorrectly translated in target (must remain as "${category}")`);
    } else if (sourceMatches.length !== targetMatches.length) {
      errors.push(`Category "${category}" count mismatch (source: ${sourceMatches.length}, target: ${targetMatches.length})`);
    }
  }

  // Check 3: Balanced braces
  const sourceOpen = (source.match(/\{/g) || []).length;
  const sourceClose = (source.match(/\}/g) || []).length;
  const targetOpen = (target.match(/\{/g) || []).length;
  const targetClose = (target.match(/\}/g) || []).length;

  if (targetOpen !== targetClose) {
    const diff = Math.abs(targetOpen - targetClose);
    if (targetOpen > targetClose) {
      errors.push(`Missing ${diff} closing brace(s) } in target`);
    } else {
      errors.push(`Missing ${diff} opening brace(s) { in target`);
    }
  } else if (targetOpen !== sourceOpen || targetClose !== sourceClose) {
    errors.push(`Brace count differs from source (source: ${sourceOpen} pairs, target: ${targetOpen} pairs)`);
  }

  // Check 4: Variable names should not change
  const sourceVars = source.match(/\{(\w+)\s*,/g) || [];
  const targetVars = target.match(/\{(\w+)\s*,/g) || [];

  if (sourceVars.length > 0 && targetVars.length > 0) {
    const sourceVarNames = sourceVars.map(v => v.match(/\{(\w+)/)?.[1]).filter(Boolean);
    const targetVarNames = targetVars.map(v => v.match(/\{(\w+)/)?.[1]).filter(Boolean);
    const sourceSet = new Set(sourceVarNames);
    const targetSet = new Set(targetVarNames);

    const changedVars = [...sourceSet].filter(v => !targetSet.has(v));
    if (changedVars.length > 0) {
      errors.push(`Variable name(s) changed: ${changedVars.join(', ')} (should not be translated)`);
    }
  }

  // Check 5: offset: not changed
  const sourceOffset = source.includes('offset:');
  const targetOffset = target.includes('offset:');

  if (sourceOffset && !targetOffset) {
    errors.push('"offset:" is missing in target');
  }

  // Check 6: Hash symbol (#) preserved
  const sourceHash = (source.match(/#/g) || []).length;
  const targetHash = (target.match(/#/g) || []).length;

  if (sourceHash > 0 && sourceHash !== targetHash) {
    errors.push(`Hash (#) count mismatch (source: ${sourceHash}, target: ${targetHash})`);
  }

  return errors;
}

// Attempt to automatically fix ICU errors
function autoFixICUError(source: string, target: string, error: string): string | null {
  // Debug logging (commented out - uncomment if needed for debugging)
  // console.log('[autoFixICUError] Called with:', { source, target, error });
  const ICU_KEYWORDS = ['plural', 'select', 'selectordinal'];
  const CATEGORY_KEYWORDS = ['zero', 'one', 'two', 'few', 'many', 'other'];

  // Fix 1: ICU keyword missing or incorrectly translated
  for (const keyword of ICU_KEYWORDS) {
    if (error.includes(`ICU keyword "${keyword}" is missing or incorrectly translated`)) {
      // Check if source has this ICU keyword
      const sourcePattern = new RegExp(`\\{[^}]+,\\s*${keyword}\\b`, 'i');

      if (sourcePattern.test(source)) {
        // Find the incorrectly translated keyword in target
        // Pattern: {variable, WRONG_KEYWORD, ...}
        const targetPattern = /\{([^,]+),\s*(\w+)\s*,/;
        const match = targetPattern.exec(target);

        if (match) {
          const fullMatch = match[0];
          const currentKeyword = match[2];

          // If the current keyword is not the correct one, replace it
          if (currentKeyword.toLowerCase() !== keyword.toLowerCase()) {
            const replacement = fullMatch.replace(currentKeyword, keyword);
            const fixed = target.replace(fullMatch, replacement);
            // console.log('[autoFixICUError] Fix 1 - ICU keyword:', { fixed });
            return fixed;
          }
        }
      }
    }
  }

  // Fix 2: Category keyword missing or incorrectly translated
  for (const category of CATEGORY_KEYWORDS) {
    if (error.includes(`Category "${category}" is missing or incorrectly translated`)) {
      // Find incorrectly translated category in target
      // Pattern: WRONG_CATEGORY {
      const sourcePattern = new RegExp(`\\b${category}\\s*\\{`, 'g');

      if (sourcePattern.test(source)) {
        // Try to find a similar word in target that should be this category
        // Common translations to check (Norwegian examples)
        const categoryTranslations: { [key: string]: string[] } = {
          'zero': ['null'],
          'one': ['en', 'ett', 'én'],
          'two': ['to'],
          'few': ['få'],
          'many': ['mange'],
          'other': ['andre', 'annet', 'annen']
        };

        const possibleWrong = categoryTranslations[category] || [];
        for (const wrong of possibleWrong) {
          const wrongPattern = new RegExp(`\\b${wrong}\\s*\\{`, 'gi');
          if (wrongPattern.test(target)) {
            const fixed = target.replace(wrongPattern, `${category} {`);
            // console.log('[autoFixICUError] Fix 2 - Category:', { category, wrong, fixed });
            return fixed;
          }
        }
      }
    }
  }

  // Fix 3: Missing closing/opening braces
  if (error.includes('Missing') && error.includes('closing brace')) {
    const count = parseInt(error.match(/Missing (\d+)/)?.[1] || '0');
    return target + '}'.repeat(count);
  }

  if (error.includes('Missing') && error.includes('opening brace')) {
    const count = parseInt(error.match(/Missing (\d+)/)?.[1] || '0');
    return '{'.repeat(count) + target;
  }

  // Fix 4: offset: missing
  if (error.includes('"offset:" is missing in target')) {
    // Find where to insert offset: by looking at source
    const sourceOffsetMatch = source.match(/\{[^}]+,\s*plural\s*,\s*offset:\s*\d+/i);
    if (sourceOffsetMatch) {
      const offsetValue = sourceOffsetMatch[0].match(/offset:\s*(\d+)/)?.[1] || '1';
      // Insert offset: after "plural,"
      return target.replace(/(\{[^}]+,\s*plural\s*,)/i, `$1 offset:${offsetValue}`);
    }
  }

  // console.log('[autoFixICUError] No fix found, returning null');
  return null;
}


// Focus trap hook for modal accessibility
function useFocusTrap(isActive: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isActive) return;

    const container = containerRef.current;
    if (!container) return;

    // Get all focusable elements
    const focusableElements = container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    // Focus first element when modal opens
    setTimeout(() => {
      firstElement?.focus();
    }, 0);

    function handleTab(e: KeyboardEvent) {
      if (e.key !== 'Tab') return;

      if (focusableElements.length === 1) {
        e.preventDefault();
        return;
      }

      if (e.shiftKey) {
        // Shift + Tab: going backwards
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        // Tab: going forwards
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    }

    container.addEventListener('keydown', handleTab);

    return () => {
      container.removeEventListener('keydown', handleTab);
    };
  }, [isActive]);

  return containerRef;
}

function hasICUSyntax(text: string): boolean {
  // Check for correct ICU syntax
  if (/\{[^}]+,\s*(plural|select|selectordinal)/i.test(text)) {
    return true;
  }
  // Check for ICU-like patterns (might have wrong keywords like "flertall" instead of "plural")
  // Pattern: {variable, word, category_keyword {
  // Example: {count, flertall, one {
  if (/\{[^}]+,\s*\w+,.*?\w+\s*\{/i.test(text)) {
    return true;
  }
  return false;
}

/**
 * Comprehensive regex pattern to detect tags/codes in XLIFF content.
 * Matches:
 * - XLIFF paired tags with content: <bpt...>...</bpt>, <ph...>...</ph>, <it...>...</it>
 * - Self-closing tags: <x/>, <x id="1"/>
 * - Closing tags: </ept>, </g>
 * - Escaped HTML tags: &lt;tag attr="value"&gt; and &amp;lt;tag attr="value"&amp;gt;
 * - Curly brace placeholders: {0}, {1}, {variableName}
 * - Square bracket placeholders: [1], [2], etc.
 * - Percent placeholders: %s, %d, %1$s, etc.
 * - HTML entities: &nbsp;, &lt;, &gt;, &#160;, etc.
 */
function getTagPattern(): RegExp {
  // Match paired XLIFF tags with their content, self-closing tags, escaped tags, entities, and placeholders
  // Pattern breakdown:
  // 1. Regular XML tags: <tag attr="value">
  // 2. Single-escaped tags: &lt;tag attr="value"&gt;
  // 3. Double-escaped tags: &amp;lt;tag attr="value"&amp;gt;
  // 4. HTML entities: &nbsp;, &quot;, &#160;, etc.
  // 5. Placeholders: {var}, [1], %s, %1$s
  return /(?:<(?:bpt|ept|ph|it|g|x|mrk|sub|ut)\b[^>]*>.*?<\/(?:bpt|ept|ph|it|g|x|mrk|sub|ut)>|<[^<>]+>|&lt;(?:[^&]|&[a-zA-Z]+;|&#x?[\da-fA-F]+;)*?&gt;|&amp;lt;(?:[^&]|&(?:amp|quot|apos|lt|gt|#x?[\da-fA-F]+);)*?&amp;gt;|&(?:[a-zA-Z]+|#x?[\da-fA-F]+);|\{[\w\d_]+\}|\[\d+\]|%(?:\d+\$)?[sd])/gs;
}

/**
 * Extract text content without tags for searching.
 * Returns text with all tags removed.
 */
function stripTags(text: string): string {
  return text.replace(getTagPattern(), '');
}

/**
 * Extract tag positions from text for highlighting.
 * Returns array of {start, end, tag} objects.
 */
function extractTags(text: string): Array<{start: number, end: number, tag: string}> {
  const tags: Array<{start: number, end: number, tag: string}> = [];
  const pattern = getTagPattern();
  let match;

  while ((match = pattern.exec(text)) !== null) {
    tags.push({
      start: match.index,
      end: match.index + match[0].length,
      tag: match[0]
    });
  }

  return tags;
}

interface AppProps {
  onFileLoaded?: (path: string) => void;
  externalFilePath?: string;
}

function App({ onFileLoaded, externalFilePath }: AppProps = {}) {
  // Multi-file state
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [displayMode, setDisplayMode] = useState<'perFile' | 'merged'>('perFile');

  // Backward-compatible derived values from files
  const xliffData: XliffData | null = useMemo(() => {
    if (files.length === 0) return null;
    // Merge all files into one flat XliffData for backward compatibility
    const allUnits: TransUnit[] = [];
    let totalUnits = 0, translated = 0, untranslated = 0;
    for (const file of files) {
      allUnits.push(...file.data.trans_units);
      totalUnits += file.data.stats.total_units;
      translated += file.data.stats.translated;
      untranslated += file.data.stats.untranslated;
    }
    return {
      trans_units: allUnits,
      stats: { total_units: totalUnits, translated, untranslated }
    };
  }, [files]);
  const filePath = files.length === 1 ? files[0].filePath : files.length > 0 ? files.map(f => f.filePath).join(', ') : '';

  // Helper to set a single file (used by existing code paths)
  function setSingleFile(path: string, data: XliffData, targetLang: string | null = null) {
    const fileName = path.split('/').pop() || path;
    setFiles([{ fileIndex: 0, filePath: path, fileName, data, targetLang }]);
    onFileLoaded?.(path);
  }

  // Load file when external path changes (from Spellcheck panel)
  useEffect(() => {
    if (externalFilePath && externalFilePath !== filePath) {
      openFileByPath(externalFilePath);
    }
  }, [externalFilePath]);

  // Build DisplayUnit array with globalId and per-file numbering
  const allDisplayUnits: DisplayUnit[] = useMemo(() => {
    const units: DisplayUnit[] = [];
    for (const file of files) {
      file.data.trans_units.forEach((unit, idx) => {
        units.push({
          ...unit,
          globalId: `${file.fileIndex}:${unit.id}`,
          fileIndex: file.fileIndex,
          fileSegmentNumber: idx + 1,
          fileName: file.fileName,
        });
      });
    }
    return units;
  }, [files]);

  const [error, setError] = useState<string>("");

  // Debug log state (commented out - uncomment if needed for debugging)
  // const [debugLogs, setDebugLogs] = useState<string[]>([]);
  // const addDebugLog = (msg: string) => {
  //   setDebugLogs(prev => [...prev.slice(-9), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  // };

  // Search/Replace state
  const [searchPattern, setSearchPattern] = useState<string>("");
  const [searchInput, setSearchInput] = useState<string>("");
  const [sourceSearchPattern, setSourceSearchPattern] = useState<string>("");
  const [sourceSearchInput, setSourceSearchInput] = useState<string>("");
  const [replacePattern, setReplacePattern] = useState<string>("");
  const [useRegex, setUseRegex] = useState<boolean>(true);
  const [caseSensitive, setCaseSensitive] = useState<boolean>(false);
  const [liveSearch, setLiveSearch] = useState<boolean>(false);
  const [searchIn, setSearchIn] = useState<'target' | 'source' | 'both'>('target');
  const [protectTags, setProtectTags] = useState<boolean>(true);

  // Edited units (track changes before saving)
  const [editedUnits, setEditedUnits] = useState<Map<string, string>>(new Map());

  // Show hidden characters toggle
  const [showHiddenChars, setShowHiddenChars] = useState<boolean>(false);

  // Simplify tags toggle — show numbered placeholders instead of raw tags
  const [simplifyTags, setSimplifyTags] = useState<boolean>(true);



  // Special characters menu
  const [showSpecialCharsMenu, setShowSpecialCharsMenu] = useState<boolean>(false);
  const [showHelpModal, setShowHelpModal] = useState<boolean>(false);
  const [showUserGuideModal, setShowUserGuideModal] = useState<boolean>(false);
  const [userGuideContent, setUserGuideContent] = useState<string>('');
  const [showChangelogModal, setShowChangelogModal] = useState<boolean>(false);
  const [changelogContent, setChangelogContent] = useState<string>('');
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [showAboutModal, setShowAboutModal] = useState<boolean>(false);

  // Update state
  const [updateAvailable, setUpdateAvailable] = useState<boolean>(false);
  const [updateVersion, setUpdateVersion] = useState<string>('');
  const [updateNotes, setUpdateNotes] = useState<string>('');
  const [isDownloadingUpdate, setIsDownloadingUpdate] = useState<boolean>(false);

  // Settings state
  const [settingsRegexLibraryPath, setSettingsRegexLibraryPath] = useState<string>("");
  const [settingsQAProfilesPath, setSettingsQAProfilesPath] = useState<string>("");

  // Selected segment for editing
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [selectedUnit, setSelectedUnit] = useState<TransUnit | null>(null);
  const [scrollPosition, setScrollPosition] = useState<number>(0);
  const [editorValue, setEditorValue] = useState<string>("");

  function clearSelection() {
    setSelectedSegmentId(null);
    setSelectedUnit(null);
    setEditorValue("");
  }

  function isUnit100(unit: TransUnit): boolean {
    return unit.metadata?.match_percent === '100' || unit.metadata?.match_quality === '100';
  }

  function isUnitLocked(unit: TransUnit): boolean {
    return unit.metadata?.locked === 'yes' || unit.metadata?.translate === 'no';
  }

  function isUnitReadOnly(unit: TransUnit): boolean {
    return (ignore100 && isUnit100(unit)) || (ignoreLocked && isUnitLocked(unit));
  }

  // Regex library state
  const [regexLibrary, setRegexLibrary] = useState<RegexLibrary>({ categories: [] });
  const [showLibraryModal, setShowLibraryModal] = useState<boolean>(false);
  const [showQuickApply, setShowQuickApply] = useState<boolean>(false);
  const [librarySearchTerm, setLibrarySearchTerm] = useState<string>("");
  const [editingEntry, setEditingEntry] = useState<RegexEntry | null>(null);
  const [newEntryCategory, setNewEntryCategory] = useState<string>("");
  const [newEntryName, setNewEntryName] = useState<string>("");
  const [newEntryDescription, setNewEntryDescription] = useState<string>("");
  const [newEntryPattern, setNewEntryPattern] = useState<string>("");
  const [newEntryReplace, setNewEntryReplace] = useState<string>("");

  // Filter for showing only edited segments
  const [showOnlyEdited, setShowOnlyEdited] = useState<boolean>(false);

  // Filter for showing only segments with ICU errors
  const [showOnlyICUErrors, setShowOnlyICUErrors] = useState<boolean>(false);

  // Filters for ignoring 100% matches and locked segments
  const [ignore100, setIgnore100] = useState<boolean>(false);
  const [ignoreLocked, setIgnoreLocked] = useState<boolean>(false);

  // Keep track of segments that matched the last search (for keeping them visible after replace)

  // Theme mode: 'light', 'dark', or 'system' (follows OS preference)
  const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'system'>('system');
  const [systemDark, setSystemDark] = useState<boolean>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const darkMode = themeMode === 'dark' || (themeMode === 'system' && systemDark);
  const setDarkMode = (dark: boolean) => setThemeMode(dark ? 'dark' : 'light');

  // 🎮 Retro mode state (secret easter eggs)
  const [retroMode, setRetroMode] = useState<boolean>(false);
  const [hackerMode, setHackerMode] = useState<boolean>(false);
  const [showRetroModeBadge, setShowRetroModeBadge] = useState<boolean>(false);
  const [easterEggMessage, setEasterEggMessage] = useState<string>("");
  const konamiSequence = useRef<string[]>([]);
  const konamiCode = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

  // TMS Integration settings
  const [tmsAutoCopy, setTmsAutoCopy] = useState<boolean>(true);

  // Jump to segment state
  const [jumpToSegment, setJumpToSegment] = useState<string>("");

  // Batch Checks state
  const [showQAModal, setShowQAModal] = useState<boolean>(false);
  const [qaProfiles, setQaProfiles] = useState<any[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<string>("");
  const [qaBatchResults, setQaBatchResults] = useState<any | null>(null);
  const [qaIsRunning, setQaIsRunning] = useState<boolean>(false);
  const [selectedMatches, setSelectedMatches] = useState<Set<string>>(new Set());

  // Batch Check Profile Editor state
  const [showProfileManager, setShowProfileManager] = useState<boolean>(false);
  const [showProfileEditor, setShowProfileEditor] = useState<boolean>(false);
  const [editingProfile, setEditingProfile] = useState<any | null>(null);
  const [profileName, setProfileName] = useState<string>("");
  const [profileDescription, setProfileDescription] = useState<string>("");
  const [profileLanguage, setProfileLanguage] = useState<string>("");
  const [profileChecks, setProfileChecks] = useState<any[]>([]);

  // TMX support
  const [tmxTargetLang, setTmxTargetLang] = useState<string | null>(null);
  const [tmxAvailableLangs, setTmxAvailableLangs] = useState<string[]>([]);
  const [tmxSrcLang, setTmxSrcLang] = useState<string>("");
  const [showTmxLangPicker, setShowTmxLangPicker] = useState<boolean>(false);
  const [pendingTmxPath, setPendingTmxPath] = useState<string>("");

  // Focus trap refs for all modals
  const helpModalRef = useFocusTrap(showHelpModal);
  const userGuideModalRef = useFocusTrap(showUserGuideModal);
  const changelogModalRef = useFocusTrap(showChangelogModal);
  const aboutModalRef = useFocusTrap(showAboutModal);
  const settingsModalRef = useFocusTrap(showSettingsModal);
  const libraryModalRef = useFocusTrap(showLibraryModal);
  const profileManagerRef = useFocusTrap(showProfileManager);
  const qaModalRef = useFocusTrap(showQAModal);
  const profileEditorRef = useFocusTrap(showProfileEditor);

  // Filter units based on search
  const filteredUnits = useMemo(() => {
    if (!xliffData || !searchPattern) {
      return xliffData?.trans_units || [];
    }

    try {
      const flags = caseSensitive ? 'g' : 'gi';
      const pattern = useRegex ? new RegExp(searchPattern, flags) : null;
      const sourcePattern = (searchIn === 'both' && sourceSearchPattern && useRegex)
        ? new RegExp(sourceSearchPattern, flags)
        : null;

      const results = xliffData.trans_units.filter(unit => {
        const targetText = editedUnits.get(unit.id) || unit.target;
        const sourceText = unit.source;

        const testText = (text: string, testPattern: RegExp | null, testSearchStr: string) => {
          let searchText = text;

          // If ignore tags is enabled, remove tags before searching
          if (protectTags) {
            searchText = stripTags(text);
          }

          if (useRegex && testPattern) {
            return testPattern.test(searchText);
          } else {
            const search = caseSensitive ? testSearchStr : testSearchStr.toLowerCase();
            const testStr = caseSensitive ? searchText : searchText.toLowerCase();
            return testStr.includes(search);
          }
        };

        if (searchIn === 'target') {
          return testText(targetText, pattern, searchPattern);
        } else if (searchIn === 'source') {
          return testText(sourceText, pattern, searchPattern);
        } else {
          // both - use separate patterns for source and target
          const targetMatches = testText(targetText, pattern, searchPattern);
          const sourceMatches = sourceSearchPattern
            ? testText(sourceText, sourcePattern, sourceSearchPattern)
            : testText(sourceText, pattern, searchPattern);

          return targetMatches && sourceMatches;
        }
      });

      return results;
    } catch (e) {
      // Invalid regex pattern
      return xliffData.trans_units;
    }
  }, [xliffData, searchPattern, sourceSearchPattern, useRegex, caseSensitive, editedUnits, searchIn, protectTags]);

  // Check for updates
  async function checkForUpdates(manual = false) {
    try {
      const update = await check();

      if (update?.available) {
        setUpdateAvailable(true);
        setUpdateVersion(update.version);
        setUpdateNotes(update.body || 'No release notes available');
      } else if (manual) {
        // Only show message if user manually checked
        await message('You are already running the latest version!', {
          title: 'No Updates Available',
          kind: 'info'
        });
      }
    } catch (error) {
      console.error('Failed to check for updates:', error);
      if (manual) {
        await message('Unable to check for updates. Please check your internet connection and try again later.', {
          title: 'Update Check Failed',
          kind: 'error'
        });
      }
    }
  }

  async function installUpdate() {
    setIsDownloadingUpdate(true);
    try {
      const update = await check();
      if (update?.available) {
        await update.downloadAndInstall();
        // Restart the app
        await relaunch();
      }
    } catch (error) {
      console.error('Failed to install update:', error);
      await message('Kunne ikke installere oppdatering. Prøv igjen senere.', {
        title: 'Feil',
        kind: 'error'
      });
    } finally {
      setIsDownloadingUpdate(false);
    }
  }

  async function openInTMS(unit: TransUnit) {
    if (!unit.tms_metadata) return;

    const tmsUrl = unit.tms_metadata.lingotek_url || unit.tms_metadata.phrase_url;
    if (!tmsUrl) return;

    // Get current value (edited or original)
    const currentValue = editedUnits.get(unit.id) || unit.target;

    // Auto-copy text if enabled
    if (tmsAutoCopy && currentValue) {
      try {
        await navigator.clipboard.writeText(currentValue);
        // Show toast notification
        const toast = document.createElement('div');
        toast.className = 'tms-toast';
        toast.textContent = '✓ Text copied to clipboard!';
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
      } catch (err) {
        console.error('Failed to copy text:', err);
      }
    }

    // Open TMS URL in browser
    try {
      await openUrl(tmsUrl);
    } catch (err) {
      console.error('Failed to open URL:', err);
      await message(`Failed to open URL: ${tmsUrl}`, {
        title: 'Error',
        kind: 'error'
      });
    }
  }

  async function openFile() {
    try {
      // Check for unsaved changes
      if (hasChanges) {
        const choice = window.confirm(
          `You have ${editedUnits.size} unsaved change(s). Do you want to save them before opening a new file?\n\n` +
          `Click OK to save, or Cancel to discard changes.`
        );

        if (choice) {
          // User wants to save
          await saveFile();
        } else {
          // User wants to discard - ask for confirmation
          const confirmDiscard = window.confirm(
            "Are you sure you want to discard all unsaved changes?"
          );
          if (!confirmDiscard) {
            // User cancelled, don't open new file
            return;
          }
        }
      }

      // Open file dialog with XLIFF/TMX file filters — supports multi-select
      const selected = await openDialog({
        multiple: true,
        filters: [{
          name: 'Translation Files',
          extensions: ['xliff', 'xlf', 'mxliff', 'mqxliff', 'sdlxliff', 'tmx']
        }]
      });

      if (selected === null) {
        // User cancelled
        return;
      }

      const paths = Array.isArray(selected) ? selected : [selected];
      if (paths.length === 0) return;

      // For single TMX file, check available languages first
      if (paths.length === 1 && paths[0].toLowerCase().endsWith('.tmx')) {
        const path = paths[0];
        const langs = await invoke<{ srclang: string; languages: string[] }>("get_tmx_languages", { filePath: path });
        const targetLangs = langs.languages.filter(l => !l.toLowerCase().startsWith(langs.srclang.toLowerCase().split('-')[0]));
        if (targetLangs.length > 1) {
          setTmxSrcLang(langs.srclang);
          setTmxAvailableLangs(targetLangs);
          setPendingTmxPath(path);
          setShowTmxLangPicker(true);
          return;
        }
        const chosenLang = targetLangs.length === 1 ? targetLangs[0] : null;
        setTmxTargetLang(chosenLang);
        setError("");
        setEditedUnits(new Map());
        clearSelection();
        const data = await invoke<XliffData>("open_xliff", { filePath: path, targetLang: chosenLang });
        setSingleFile(path, data, chosenLang);
        return;
      }

      // Load all selected files (multi-file or single non-TMX)
      setTmxTargetLang(null);
      setError("");
      setEditedUnits(new Map());
      clearSelection();

      const entries: FileEntry[] = [];
      for (let i = 0; i < paths.length; i++) {
        const p = paths[i];
        const data = await invoke<XliffData>("open_xliff", { filePath: p, targetLang: null });
        entries.push({
          fileIndex: i,
          filePath: p,
          fileName: p.split('/').pop() || p,
          data,
          targetLang: null,
        });
      }
      setFiles(entries);
    } catch (err) {
      setError(`Error opening file: ${err}`);
      console.error(err);
    }
  }

  // Open a specific file path directly (used by SpellcheckQA IPC handoff)
  async function openFileByPath(path: string) {
    try {
      setTmxTargetLang(null);
      setError("");
      setEditedUnits(new Map());
      clearSelection();
      const data = await invoke<XliffData>("open_xliff", { filePath: path, targetLang: null });
      setSingleFile(path, data);
    } catch (err) {
      setError(`Error opening file: ${err}`);
      console.error(err);
    }
  }

  function handleCellEdit(unitId: string, newValue: string) {
    const newEdits = new Map(editedUnits);
    newEdits.set(unitId, newValue);
    setEditedUnits(newEdits);
    setEditorValue(newValue); // Update editor value when user types
  }

  function handleSearch() {
    // 🔫 DOOM Easter Egg - IDKFA (God mode cheat code)
    if (searchInput.toLowerCase() === 'idkfa') {
      setRetroMode(true);
      setEasterEggMessage("VERY HAPPY AMMO ADDED!");
      setShowRetroModeBadge(true);
      setSearchInput(""); // Clear the search

      // 🔊 Play modem sound
      getRetroSoundGenerator().playModemConnect().catch(err =>
        console.warn('Audio playback failed:', err)
      );

      setTimeout(() => {
        setShowRetroModeBadge(false);
        setEasterEggMessage("");
      }, 3000);
      return;
    }

    // 🔫 DOOM Easter Egg - IDDQD (God mode)
    if (searchInput.toLowerCase() === 'iddqd') {
      setRetroMode(true);
      setEasterEggMessage("DEGREELESSNESS MODE!");
      setShowRetroModeBadge(true);
      setSearchInput("");

      // 🔊 Play modem sound
      getRetroSoundGenerator().playModemConnect().catch(err =>
        console.warn('Audio playback failed:', err)
      );

      setTimeout(() => {
        setShowRetroModeBadge(false);
        setEasterEggMessage("");
      }, 3000);
      return;
    }

    // 🎮 Classic Adventure Easter Egg - XYZZY
    if (searchInput.toLowerCase() === 'xyzzy') {
      setRetroMode(true);
      setEasterEggMessage("NOTHING HAPPENS.");
      setShowRetroModeBadge(true);
      setSearchInput("");

      // 🔊 Play modem sound
      getRetroSoundGenerator().playModemConnect().catch(err =>
        console.warn('Audio playback failed:', err)
      );

      setTimeout(() => {
        setShowRetroModeBadge(false);
        setEasterEggMessage("");
      }, 3000);
      return;
    }

    // 🖥️ WarGames Easter Egg - WHOPR (green screen hacker mode)
    if (searchInput.toLowerCase() === 'whopr') {
      setHackerMode(true);
      setRetroMode(false); // Turn off DOS blue mode if it was on
      setEasterEggMessage("SHALL WE PLAY A GAME?");
      setShowRetroModeBadge(true);
      setSearchInput("");

      // 🔊 Play modem sound
      getRetroSoundGenerator().playModemConnect().catch(err =>
        console.warn('Audio playback failed:', err)
      );

      setTimeout(() => {
        setShowRetroModeBadge(false);
        setEasterEggMessage("");
      }, 3000);
      return;
    }

    // 🖥️ 1337 Easter Egg - Elite Hacker Mode (green screen)
    if (searchInput === '1337') {
      setHackerMode(true);
      setRetroMode(false); // Turn off DOS blue mode if it was on
      setEasterEggMessage("ELITE HACKER MODE!");
      setShowRetroModeBadge(true);
      setSearchInput("");

      // 🔊 Play modem sound
      getRetroSoundGenerator().playModemConnect().catch(err =>
        console.warn('Audio playback failed:', err)
      );

      setTimeout(() => {
        setShowRetroModeBadge(false);
        setEasterEggMessage("");
      }, 3000);
      return;
    }

    setSearchPattern(searchInput);
    if (searchIn === 'both') {
      setSourceSearchPattern(sourceSearchInput);
    }
  }

  function handleSearchKeyPress(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      handleSearch();
    }
  }

  function handleClearSearch() {
    setSearchInput("");
    setSearchPattern("");
    setSourceSearchInput("");
    setSourceSearchPattern("");
    setReplacePattern("");
  }

  function handleJumpToSegment() {
    if (!jumpToSegment || !xliffData) return;

    // Find segment by ID or display ID
    const targetUnit = xliffData.trans_units.find(unit => {
      // For MXLIFF: extract number after colon and add 1 for comparison
      // For SDLXLIFF: ID is already the display number
      let displayId: string;
      if (unit.id.includes(':')) {
        const numAfterColon = unit.id.split(':').pop();
        displayId = numAfterColon && /^\d+$/.test(numAfterColon)
          ? String(parseInt(numAfterColon, 10) + 1)
          : unit.id;
      } else {
        displayId = unit.id;
      }
      return displayId === jumpToSegment || unit.id === jumpToSegment;
    });

    if (targetUnit) {
      setJumpToSegment("");
      const row = document.querySelector(`tr[title="Full ID: ${targetUnit.id}"]`);
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      alert(`Segment ${jumpToSegment} not found`);
    }
  }

  function handleJumpKeyPress(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      handleJumpToSegment();
    }
  }

  function replaceInMatches() {
    if (!xliffData || !searchPattern || !replacePattern) return;

    const newEdits = new Map(editedUnits);

    try {
      filteredUnits.forEach(unit => {
        // Skip 100% and locked units when ignore filters are active
        if (ignore100 && isUnit100(unit)) return;
        if (ignoreLocked && isUnitLocked(unit)) return;
        const currentText = editedUnits.get(unit.id) || unit.target;
        let replaced: string;

        if (protectTags) {
          // Extract text segments and tags using comprehensive tag detection
          const tags = extractTags(currentText);

          // Extract text segments
          const segments: string[] = [];
          for (let i = 0; i <= tags.length; i++) {
            const segmentStart = i === 0 ? 0 : tags[i - 1].end;
            const segmentEnd = i === tags.length ? currentText.length : tags[i].start;
            segments.push(currentText.substring(segmentStart, segmentEnd));
          }

          // Replace in each text segment
          const replacedSegments = segments.map(segment => {
            if (useRegex) {
              const flags = caseSensitive ? 'g' : 'gi';
              const pattern = new RegExp(searchPattern, flags);
              return segment.replace(pattern, replacePattern);
            } else {
              // Plain text search
              if (caseSensitive) {
                return segment.split(searchPattern).join(replacePattern);
              } else {
                const lowerText = segment.toLowerCase();
                const lowerSearch = searchPattern.toLowerCase();
                let lastIndex = 0;
                let newText = '';

                while (true) {
                  const index = lowerText.indexOf(lowerSearch, lastIndex);
                  if (index === -1) {
                    newText += segment.substring(lastIndex);
                    break;
                  }
                  newText += segment.substring(lastIndex, index) + replacePattern;
                  lastIndex = index + searchPattern.length;
                }
                return newText;
              }
            }
          });

          // Reconstruct text with tags
          const parts: string[] = [];
          for (let i = 0; i < replacedSegments.length; i++) {
            parts.push(replacedSegments[i]);
            if (i < tags.length) {
              parts.push(tags[i].tag);
            }
          }
          replaced = parts.join('');
        } else {
          // Original behavior - replace in full text including tags
          if (useRegex) {
            const flags = caseSensitive ? 'g' : 'gi';
            const pattern = new RegExp(searchPattern, flags);
            replaced = currentText.replace(pattern, replacePattern);
          } else {
            // Plain text search - use split/join for global replace
            if (caseSensitive) {
              replaced = currentText.split(searchPattern).join(replacePattern);
            } else {
              // Case-insensitive plain text replace
              const lowerText = currentText.toLowerCase();
              const lowerSearch = searchPattern.toLowerCase();
              let result = currentText;
              let lastIndex = 0;
              let newText = '';

              while (true) {
                const index = lowerText.indexOf(lowerSearch, lastIndex);
                if (index === -1) {
                  newText += result.substring(lastIndex);
                  break;
                }
                newText += result.substring(lastIndex, index) + replacePattern;
                lastIndex = index + searchPattern.length;
              }
              replaced = newText;
            }
          }
        }

        if (replaced !== currentText) {
          newEdits.set(unit.id, replaced);
        }
      });

      setEditedUnits(newEdits);
    } catch (e) {
      setError(`Replace error: ${e}`);
    }
  }

  // Apply ICU error fix for a specific segment and error
  async function applyICUFix(segmentId: string, error: string) {
    // Debug logging (commented out - uncomment if needed)
    // addDebugLog(`START Fix - Error: ${error.substring(0, 50)}...`);
    if (!xliffData) return;

    const unit = xliffData.trans_units.find(u => u.id === segmentId);
    if (!unit) {
      // addDebugLog('ERROR: Unit not found');
      return;
    }

    const currentTarget = editedUnits.get(segmentId) || unit.target;
    // addDebugLog(`Current: ${currentTarget.substring(0, 40)}...`);

    const fixedTarget = autoFixICUError(unit.source, currentTarget, error);
    // addDebugLog(`Fixed: ${fixedTarget ? fixedTarget.substring(0, 40) + '...' : 'NULL'}`);

    if (fixedTarget && fixedTarget !== currentTarget) {
      // addDebugLog('✓ Applying fix - updating state');
      const newEdits = new Map(editedUnits);
      newEdits.set(segmentId, fixedTarget);
      setEditedUnits(newEdits);
      setEditorValue(fixedTarget); // Update editor value immediately
      // addDebugLog('✓ State updated successfully');
    } else {
      // addDebugLog('✗ No fix available or same as current');
      await message('Unable to automatically fix this error. Please correct it manually.', {
        title: 'Auto-Fix Not Available',
        kind: 'warning'
      });
    }
  }

  const hasChanges = editedUnits.size > 0;

  // Pre-process tags for all trans units (computed once when file is loaded, not on every render)
  const processedTags = useMemo(() => {
    if (!xliffData) return new Map<string, { source: ProcessedSegment; target: ProcessedSegment }>();
    const map = new Map<string, { source: ProcessedSegment; target: ProcessedSegment }>();
    for (const unit of xliffData.trans_units) {
      map.set(unit.id, {
        source: processSegmentTags(unit.source),
        target: processSegmentTags(unit.target),
      });
    }
    return map;
  }, [xliffData]);

  // Also process edited units' targets when they change
  const processedEdited = useMemo(() => {
    const map = new Map<string, ProcessedSegment>();
    editedUnits.forEach((target, id) => {
      map.set(id, processSegmentTags(target));
    });
    return map;
  }, [editedUnits]);

  // Load regex library on component mount
  useEffect(() => {
    async function loadLibrary() {
      try {
        const library = await invoke<RegexLibrary>("load_regex_library");
        setRegexLibrary(library);
      } catch (err) {
        console.error("Failed to load regex library:", err);
      }
    }
    loadLibrary();
  }, []);

  // Listen for OS dark mode changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Load TMS settings from localStorage
  useEffect(() => {
    const savedAutoCopy = localStorage.getItem('tmsAutoCopy');
    if (savedAutoCopy !== null) {
      setTmsAutoCopy(savedAutoCopy === 'true');
    }
  }, []);

  // Save TMS settings to localStorage
  useEffect(() => {
    localStorage.setItem('tmsAutoCopy', tmsAutoCopy.toString());
  }, [tmsAutoCopy]);

  // Check for updates on startup
  useEffect(() => {
    // Wait 3 seconds before checking so the app can load first
    const timer = setTimeout(() => {
      checkForUpdates(false);
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  // Listen to menu events
  useEffect(() => {
    const unlistenAbout = listen('menu-about', () => {
      setShowAboutModal(true);
    });

    const unlistenOpen = listen('menu-open', () => {
      openFile();
    });

    const unlistenSave = listen('menu-save', () => {
      if (filePath) saveFile();
    });

    const unlistenSettings = listen('menu-settings', () => {
      setShowSettingsModal(true);
    });

    const unlistenHiddenChars = listen('menu-toggle-hidden-chars', () => {
      setShowHiddenChars(!showHiddenChars);
    });

    const unlistenDarkMode = listen('menu-toggle-dark-mode', () => {
      setDarkMode(!darkMode);
    });

    const unlistenRegexLibrary = listen('menu-regex-library', () => {
      setShowLibraryModal(!showLibraryModal);
    });

    const unlistenQAProfiles = listen('menu-qa-profiles', () => {
      setShowProfileManager(!showProfileManager);
      if (!showProfileManager) loadQAProfiles();
    });

    const unlistenSpecialChars = listen('menu-special-chars', () => {
      setShowSpecialCharsMenu(!showSpecialCharsMenu);
    });

    const unlistenShortcuts = listen('menu-show-shortcuts', () => {
      setShowHelpModal(true);
    });

    const unlistenUserGuide = listen('menu-user-guide', async () => {
      try {
        const content = await invoke<string>('get_user_guide_content');
        setUserGuideContent(content);
        setShowUserGuideModal(true);
      } catch (error) {
        console.error('Failed to load user guide:', error);
        alert(`Failed to load user guide: ${error}`);
      }
    });

    const unlistenChangelog = listen('menu-changelog', async () => {
      try {
        const content = await invoke<string>('get_changelog_content');
        // Parse Markdown to HTML
        const htmlContent = await marked(content);
        setChangelogContent(htmlContent);
        setShowChangelogModal(true);
      } catch (error) {
        console.error('Failed to load changelog:', error);
        alert(`Failed to load changelog: ${error}`);
      }
    });

    const unlistenCheckUpdates = listen('menu-check-updates', () => {
      checkForUpdates(true);
    });

    return () => {
      unlistenAbout.then(f => f());
      unlistenOpen.then(f => f());
      unlistenSave.then(f => f());
      unlistenSettings.then(f => f());
      unlistenHiddenChars.then(f => f());
      unlistenDarkMode.then(f => f());
      unlistenRegexLibrary.then(f => f());
      unlistenQAProfiles.then(f => f());
      unlistenSpecialChars.then(f => f());
      unlistenShortcuts.then(f => f());
      unlistenUserGuide.then(f => f());
      unlistenChangelog.then(f => f());
      unlistenCheckUpdates.then(f => f());
    };
  }, [filePath, showHiddenChars, darkMode, showLibraryModal, showProfileManager, showSpecialCharsMenu]);

  // Sync menu checkbox state when darkMode or showHiddenChars change
  useEffect(() => {
    emit('sync-menu-checkboxes', {
      darkMode,
      showHiddenChars
    });
  }, [darkMode, showHiddenChars]);

  // Preserve scroll position when opening/closing editor
  useEffect(() => {
    // The actual scrolling element is .content, not #table-container
    const container = document.querySelector('.content');
    if (!container) return;

    if (selectedSegmentId) {
      // When opening editor: scroll the selected row into view in the table
      requestAnimationFrame(() => {
        const selectedRow = document.querySelector('.selected-row');
        if (selectedRow) {
          selectedRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    } else if (scrollPosition > 0) {
      // When closing editor: restore scroll position
      requestAnimationFrame(() => {
        container.scrollTop = scrollPosition;
      });
    }
  }, [selectedSegmentId, scrollPosition]);

  // 🎮 Retro mode keyboard shortcut (Cmd+R / Ctrl+R)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Cmd+R (Mac) or Ctrl+R (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault(); // Prevent browser reload
        setRetroMode(prev => !prev);
        setHackerMode(false); // Turn off hacker mode when toggling retro mode

        // Show the "RETRO MODE ACTIVATED" badge
        if (!retroMode) {
          setShowRetroModeBadge(true);

          // 🔊 Play modem sound when activating retro mode
          getRetroSoundGenerator().playModemConnect().catch(err =>
            console.warn('Audio playback failed:', err)
          );

          setTimeout(() => {
            setShowRetroModeBadge(false);
          }, 2000);
        }
      }

      // Check for Cmd+G (Mac) or Ctrl+G (Windows/Linux) - Hacker Mode
      if ((e.metaKey || e.ctrlKey) && e.key === 'g') {
        e.preventDefault();
        setHackerMode(prev => !prev);
        setRetroMode(false); // Turn off retro mode when toggling hacker mode

        // Show the "HACKER MODE ACTIVATED" badge
        if (!hackerMode) {
          setShowRetroModeBadge(true);
          setEasterEggMessage("HACKER MODE!");

          // 🔊 Play modem sound when activating hacker mode
          getRetroSoundGenerator().playModemConnect().catch(err =>
            console.warn('Audio playback failed:', err)
          );

          setTimeout(() => {
            setShowRetroModeBadge(false);
            setEasterEggMessage("");
          }, 2000);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [retroMode, hackerMode]);

  // 🎮 Konami Code easter egg (↑↑↓↓←→←→BA)
  useEffect(() => {
    const handleKonamiCode = (e: KeyboardEvent) => {
      // Only track if no input is focused
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      konamiSequence.current.push(e.key);

      // Keep only last 10 keys
      if (konamiSequence.current.length > 10) {
        konamiSequence.current.shift();
      }

      // Check if sequence matches Konami Code
      const sequenceString = konamiSequence.current.join(',');
      const konamiString = konamiCode.join(',');

      if (sequenceString === konamiString) {
        // KONAMI CODE ACTIVATED! 🎮
        setRetroMode(true);
        setEasterEggMessage("CHEAT CODE ACCEPTED!");
        setShowRetroModeBadge(true);

        // 🔊 Play modem sound
        getRetroSoundGenerator().playModemConnect().catch(err =>
          console.warn('Audio playback failed:', err)
        );

        // Reset sequence
        konamiSequence.current = [];

        // Hide badge after 3 seconds
        setTimeout(() => {
          setShowRetroModeBadge(false);
          setEasterEggMessage("");
        }, 3000);
      }
    };

    window.addEventListener('keydown', handleKonamiCode);
    return () => window.removeEventListener('keydown', handleKonamiCode);
  }, []);

  // Close quick-apply dropdown when clicking outside
  useEffect(() => {
    if (!showQuickApply) return;

    const handleClickOutside = () => {
      setShowQuickApply(false);
    };

    // Small timeout to prevent immediate close on the same click that opened it
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showQuickApply]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;

      // Check if we're in an input field
      const isInputField = (e.target as HTMLElement).tagName === 'INPUT' ||
                          (e.target as HTMLElement).tagName === 'TEXTAREA' ||
                          (e.target as HTMLElement).tagName === 'SELECT';

      // Don't process shortcuts when in input fields (except specific cases)
      if (isInputField) {
        // Still allow Cmd+F and Escape in input fields
        if (!(isMod && e.key === 'f') && e.key !== 'Escape') {
          return; // Let browser handle all other keys naturally
        }
      }

      // Cmd/Ctrl + F: Focus search field
      if (isMod && e.key === 'f') {
        e.preventDefault();
        const searchField = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement;
        if (searchField) searchField.focus();
        return;
      }

      // Cmd/Ctrl + O: Open file
      if (isMod && e.key === 'o') {
        e.preventDefault();
        openFile();
        return;
      }

      // Cmd/Ctrl + S: Save file
      if (isMod && e.key === 's' && filePath) {
        e.preventDefault();
        saveFile();
        return;
      }

      // Cmd/Ctrl + L: Open Regex Library
      if (isMod && e.key === 'l') {
        e.preventDefault();
        setShowLibraryModal(!showLibraryModal);
        return;
      }

      // Cmd/Ctrl + Q: Open Batch Check Profiles
      if (isMod && e.key === 'p') {
        e.preventDefault();
        setShowProfileManager(!showProfileManager);
        if (!showProfileManager) loadQAProfiles();
        return;
      }

      // Escape: Close modals or editor panel
      if (e.key === 'Escape') {
        e.preventDefault();
        if (showAboutModal) setShowAboutModal(false);
        else if (showSettingsModal) setShowSettingsModal(false);
        else if (showHelpModal) setShowHelpModal(false);
        else if (showLibraryModal) setShowLibraryModal(false);
        else if (showProfileManager) setShowProfileManager(false);
        else if (showProfileEditor) setShowProfileEditor(false);
        else if (showQAModal) setShowQAModal(false);
        else if (showSpecialCharsMenu) setShowSpecialCharsMenu(false);
        else if (selectedSegmentId) {
          clearSelection();
        }
        return;
      }

      // Cmd+Up: Scroll to first segment (without opening editor)
      if (isMod && e.key === 'ArrowUp') {
        e.preventDefault();
        const firstRow = document.querySelector('tbody tr');
        if (firstRow) firstRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      // Cmd+Down: Scroll to last segment (without opening editor)
      else if (isMod && e.key === 'ArrowDown') {
        e.preventDefault();
        const rows = document.querySelectorAll('tbody tr');
        const lastRow = rows[rows.length - 1];
        if (lastRow) lastRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedSegmentId, showLibraryModal, showProfileManager, showProfileEditor, showQAModal, showSpecialCharsMenu, showHelpModal, filePath]);

  // Function to display text with hidden characters visible
  function displayWithHiddenChars(text: string): string {
    if (!showHiddenChars) return text;

    return text
      .replace(/ /g, '·')           // Regular space → middle dot
      .replace(/\u00A0/g, '°')      // Non-breaking space (hard space) → degree symbol
      .replace(/\t/g, '→')          // Tab → arrow
      .replace(/\n/g, '¶\n')        // Line break → pilcrow
      .replace(/\r/g, '');          // Remove carriage return
  }

  /**
   * Render a processed segment with numbered tag pills or raw tags.
   * When simplifyTags is on, tags become small colored pills like {1}, {/1}, {2}.
   * When off, renders raw text as before.
   */
  function renderSegmentWithTags(
    text: string,
    processed: ProcessedSegment | undefined,
    applyHiddenChars: boolean
  ): React.ReactNode {
    if (!simplifyTags || !processed || processed.displayParts.length === 0) {
      return applyHiddenChars ? displayWithHiddenChars(text) : text;
    }

    return <>{processed.displayParts.map((part, i) => {
      if (part.type === 'text') {
        const content = applyHiddenChars ? displayWithHiddenChars(part.content) : part.content;
        return <span key={i}>{content}</span>;
      }
      // Tag pill
      const label = part.tagType === 'close' ? `/${part.number}` : `${part.number}`;
      const pillClass = `tag-pill tag-pill-${part.tagType}`;
      return (
        <span key={i} className={pillClass} title={part.original}>
          {label}
        </span>
      );
    })}</>;
  }

  /**
   * Render segment with tag pills AND search highlighting.
   * Combines tag simplification with match highlighting.
   */
  function renderSegmentWithTagsAndHighlight(
    text: string,
    processed: ProcessedSegment | undefined,
    applyHiddenChars: boolean
  ): React.ReactNode {
    if (!searchPattern) {
      return renderSegmentWithTags(text, processed, applyHiddenChars);
    }

    // If not simplifying tags, fall back to existing highlightMatches
    if (!simplifyTags || !processed || processed.displayParts.length === 0) {
      return highlightMatches(text, applyHiddenChars);
    }

    // Highlight within text parts only, render tags as pills
    try {
      const flags = caseSensitive ? 'g' : 'gi';
      let pattern: RegExp;
      if (useRegex) {
        pattern = new RegExp(searchPattern, flags);
      } else {
        const escapedPattern = searchPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        pattern = new RegExp(escapedPattern, flags);
      }

      const elements: React.ReactNode[] = [];
      let key = 0;

      for (const part of processed.displayParts) {
        if (part.type === 'tag') {
          const label = part.tagType === 'close' ? `/${part.number}` : `${part.number}`;
          const pillClass = `tag-pill tag-pill-${part.tagType}`;
          elements.push(
            <span key={`tag-${key++}`} className={pillClass} title={part.original}>
              {label}
            </span>
          );
          continue;
        }

        // Text part — apply search highlighting
        const segment = part.content;
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        pattern.lastIndex = 0;

        while ((match = pattern.exec(segment)) !== null) {
          if (match.index > lastIndex) {
            const before = segment.substring(lastIndex, match.index);
            elements.push(<span key={`t-${key++}`}>{applyHiddenChars ? displayWithHiddenChars(before) : before}</span>);
          }
          elements.push(
            <mark key={`m-${key++}`} className="search-highlight">
              {applyHiddenChars ? displayWithHiddenChars(match[0]) : match[0]}
            </mark>
          );
          lastIndex = match.index + match[0].length;
          if (match.index === pattern.lastIndex) pattern.lastIndex++;
        }

        if (lastIndex < segment.length) {
          const remaining = segment.substring(lastIndex);
          elements.push(<span key={`t-${key++}`}>{applyHiddenChars ? displayWithHiddenChars(remaining) : remaining}</span>);
        }
      }

      return elements.length > 0 ? <>{elements}</> : (applyHiddenChars ? displayWithHiddenChars(text) : text);
    } catch {
      return renderSegmentWithTags(text, processed, applyHiddenChars);
    }
  }

  // Insert special character at cursor position in search/replace fields
  function insertSpecialChar(char: string, field: 'search' | 'replace') {
    if (field === 'search') {
      setSearchInput(searchInput + char);
    } else {
      setReplacePattern(replacePattern + char);
    }
    setShowSpecialCharsMenu(false);
  }

  // Load Batch Check profiles when modal is opened
  async function loadQAProfiles() {
    try {
      const profiles = await invoke<any[]>("list_qa_profiles");
      setQaProfiles(profiles);
      if (profiles.length > 0 && !selectedProfile) {
        setSelectedProfile(profiles[0].path);
      }
    } catch (err) {
      console.error("Failed to load Batch Check profiles:", err);
      setError(`Failed to load Batch Check profiles: ${err}`);
    }
  }

  // Run batch find checks
  async function runBatchChecks() {
    if (!filePath || !selectedProfile) {
      setError("Please open a file and select a profile first");
      return;
    }

    setQaIsRunning(true);
    setQaBatchResults(null);

    try {
      const result = await invoke<any>("batch_find", {
        filePath: filePath,
        profilePath: selectedProfile
      });
      setQaBatchResults(result);

      // Auto-select all matches by default
      if (result && result.matches) {
        const allMatchIds = new Set<string>(
          result.matches.map((m: any, idx: number) => `${m.tu_id}-${m.check_name}-${idx}` as string)
        );
        setSelectedMatches(allMatchIds);
      }
    } catch (err) {
      console.error("Batch check error:", err);
      setError(`Batch check error: ${err}`);
    } finally {
      setQaIsRunning(false);
    }
  }

  // Toggle match selection
  function toggleMatchSelection(matchId: string) {
    const newSelected = new Set(selectedMatches);
    if (newSelected.has(matchId)) {
      newSelected.delete(matchId);
    } else {
      newSelected.add(matchId);
    }
    setSelectedMatches(newSelected);
  }

  // Select/Deselect all matches
  function toggleAllMatches(select: boolean) {
    if (select && qaBatchResults && qaBatchResults.matches) {
      const allMatchIds = new Set<string>(
        qaBatchResults.matches.map((m: any, idx: number) => `${m.tu_id}-${m.check_name}-${idx}`)
      );
      setSelectedMatches(allMatchIds);
    } else {
      setSelectedMatches(new Set<string>());
    }
  }

  // Run batch replace (Replace All)
  async function runBatchReplace() {
    if (!filePath || !selectedProfile) {
      setError("Please open a file and select a profile first");
      return;
    }

    const confirmed = await ask('This will apply all fixes from the profile. A backup will be created. Continue?', {
      title: 'Confirm Batch Replace',
      kind: 'warning'
    });

    if (!confirmed) {
      return;
    }

    setQaIsRunning(true);

    try {
      const result = await invoke<any>("batch_replace", {
        filePath: filePath,
        profilePath: selectedProfile
      });

      await message(`Success! Fixed ${result.total_replacements} issue(s) in ${result.modified_units} segment(s).`, {
        title: 'Batch Replace Complete',
        kind: 'info'
      });

      // Reload files to show updated content
      const reloadedFiles: FileEntry[] = [];
      for (const file of files) {
        const data = await invoke<XliffData>("open_xliff", { filePath: file.filePath, targetLang: file.targetLang });
        reloadedFiles.push({ ...file, data });
      }
      setFiles(reloadedFiles);
      setEditedUnits(new Map());
      setQaBatchResults(null); // Clear results
      setShowQAModal(false); // Close modal
    } catch (err) {
      console.error("Batch replace error:", err);
      setError(`Batch replace error: ${err}`);
    } finally {
      setQaIsRunning(false);
    }
  }

  // Stage batch check fixes into editedUnits (instead of writing directly to disk)
  function stageBatchFixes() {
    if (!qaBatchResults?.matches || !xliffData) return;

    const newEdits = new Map(editedUnits);

    // Group selected matches by tu_id, preserving order
    const matchesByUnit = new Map<string, any[]>();
    qaBatchResults.matches.forEach((match: any, idx: number) => {
      const matchId = `${match.tu_id}-${match.check_name}-${idx}`;
      if (!selectedMatches.has(matchId)) return;
      if (!matchesByUnit.has(match.tu_id)) matchesByUnit.set(match.tu_id, []);
      matchesByUnit.get(match.tu_id)!.push(match);
    });

    // Apply all replacements for each unit
    matchesByUnit.forEach((matches, tuId) => {
      // Start from current edited value or original
      let text = newEdits.get(tuId) || (xliffData.trans_units.find(u => u.id === tuId)?.target ?? '');

      for (const match of matches) {
        if (!match.pattern || !match.replacement) continue;
        try {
          const regex = new RegExp(match.pattern, 'g');
          text = text.replace(regex, match.replacement);
        } catch {
          // Skip invalid patterns
        }
      }

      newEdits.set(tuId, text);
    });

    setEditedUnits(newEdits);
    setQaBatchResults(null);
    setShowQAModal(false);
  }

  // Batch Check Profile Editor functions
  function createNewProfile() {
    setEditingProfile(null);
    setProfileName("New Batch Check Profile");
    setProfileDescription("");
    setProfileLanguage("");
    setProfileChecks([]);
    setShowProfileEditor(true);
  }

  async function editProfile(profile: any) {
    try {
      setEditingProfile(profile);

      // Load profile data from XML
      const profileData = await invoke<any>("load_qa_profile", {
        profilePath: profile.path
      });

      setProfileName(profileData.name || "");
      setProfileDescription(profileData.description || "");
      setProfileLanguage(profileData.language || "");
      setProfileChecks(profileData.checks || []);
      setShowProfileEditor(true);
    } catch (err) {
      console.error("Failed to load profile:", err);
      setError(`Failed to load profile: ${err}`);
    }
  }

  async function deleteProfile(profile: any) {
    const confirmed = window.confirm(`Are you sure you want to delete the profile "${profile.name}"?`);
    if (!confirmed) {
      return;
    }

    try {
      await invoke("delete_qa_profile", {
        profilePath: profile.path
      });

      // Reload profiles list
      await loadQAProfiles();

      // Clear selection if deleted profile was selected
      if (selectedProfile === profile.path) {
        setSelectedProfile("");
      }
    } catch (err) {
      console.error("Failed to delete profile:", err);
      setError(`Failed to delete profile: ${err}`);
    }
  }

  function addCheckToProfile() {
    const newCheck = {
      order: profileChecks.length + 1,
      enabled: true,
      name: "",
      description: "",
      pattern: "",
      replacement: "",
      category: "Custom",
      case_sensitive: false,
      exclude_pattern: ""
    };
    setProfileChecks([...profileChecks, newCheck]);
  }

  function updateCheck(index: number, field: string, value: any) {
    const updated = [...profileChecks];
    updated[index] = { ...updated[index], [field]: value };
    setProfileChecks(updated);
  }

  function removeCheck(index: number) {
    const updated = profileChecks.filter((_, i) => i !== index);
    // Renumber orders
    updated.forEach((check, i) => {
      check.order = i + 1;
    });
    setProfileChecks(updated);
  }

  function moveCheckUp(index: number) {
    if (index === 0) return;
    const updated = [...profileChecks];
    [updated[index - 1], updated[index]] = [updated[index], updated[index - 1]];
    // Update orders
    updated.forEach((check, i) => {
      check.order = i + 1;
    });
    setProfileChecks(updated);
  }

  function moveCheckDown(index: number) {
    if (index === profileChecks.length - 1) return;
    const updated = [...profileChecks];
    [updated[index], updated[index + 1]] = [updated[index + 1], updated[index]];
    // Update orders
    updated.forEach((check, i) => {
      check.order = i + 1;
    });
    setProfileChecks(updated);
  }

  async function saveProfile() {
    if (!profileName.trim()) {
      setError("Profile name is required");
      return;
    }

    if (profileChecks.length === 0) {
      setError("Please add at least one check to the profile");
      return;
    }

    const profileData = {
      name: profileName,
      description: profileDescription,
      language: profileLanguage,
      checks: profileChecks
    };

    try {
      // Generate filename
      const fileName = `${profileName.toLowerCase().replace(/\s+/g, '_')}_qa_profile.xml`;

      // Save via Tauri
      const savedPath = await invoke<string>("save_qa_profile", {
        profileData: profileData,
        fileName: fileName
      });

      alert(`Profile saved successfully!\n${savedPath}`);

      // Reload profiles list
      await loadQAProfiles();

      setShowProfileEditor(false);
    } catch (err) {
      console.error("Failed to save profile:", err);
      setError(`Failed to save profile: ${err}`);
    }
  }

  function addPatternFromLibrary(pattern: RegexEntry) {
    const newCheck = {
      order: profileChecks.length + 1,
      enabled: true,
      name: pattern.name,
      description: pattern.description,
      pattern: pattern.pattern,
      replacement: pattern.replace,
      category: pattern.category,
      case_sensitive: false,
      exclude_pattern: ""
    };
    setProfileChecks([...profileChecks, newCheck]);
  }

  async function exportRegexLibrary() {
    try {
      // Open save dialog
      const filePath = await save({
        filters: [{
          name: 'XML',
          extensions: ['xml']
        }],
        defaultPath: 'regex-library.xml'
      });

      if (!filePath) return; // User cancelled

      // Export library via Tauri
      const result = await invoke<string>("export_regex_library", {
        library: regexLibrary,
        exportPath: filePath
      });

      alert(result);
    } catch (err) {
      console.error("Failed to export library:", err);
      setError(`Failed to export library: ${err}`);
    }
  }

  async function importRegexLibrary() {
    try {
      // Open file dialog
      const selected = await openDialog({
        filters: [{
          name: 'XML',
          extensions: ['xml']
        }],
        multiple: false
      });

      if (!selected || typeof selected !== 'string') return; // User cancelled

      // Import library via Tauri
      const importedLibrary = await invoke<RegexLibrary>("import_regex_library", {
        importPath: selected
      });

      // Merge with existing library
      const mergedCategories = [...regexLibrary.categories];

      for (const importedCategory of importedLibrary.categories) {
        const existingCategoryIndex = mergedCategories.findIndex(
          cat => cat.name === importedCategory.name
        );

        if (existingCategoryIndex >= 0) {
          // Merge entries into existing category, avoiding duplicates
          const existingCategory = mergedCategories[existingCategoryIndex];
          for (const importedEntry of importedCategory.entries) {
            const isDuplicate = existingCategory.entries.some(
              entry => entry.pattern === importedEntry.pattern && entry.name === importedEntry.name
            );
            if (!isDuplicate) {
              // Add unique ID
              existingCategory.entries.push({
                ...importedEntry,
                id: Date.now().toString() + Math.random().toString()
              });
            }
          }
        } else {
          // Add new category
          mergedCategories.push({
            name: importedCategory.name,
            entries: importedCategory.entries.map(entry => ({
              ...entry,
              id: Date.now().toString() + Math.random().toString()
            }))
          });
        }
      }

      const mergedLibrary = { categories: mergedCategories };
      setRegexLibrary(mergedLibrary);

      // Save merged library
      await invoke("save_regex_library", { library: mergedLibrary });

      alert(`Library imported successfully! Added patterns from ${selected}`);
    } catch (err) {
      console.error("Failed to import library:", err);
      setError(`Failed to import library: ${err}`);
    }
  }

  async function importChecksFromXML() {
    try {
      // Open file dialog (reuse existing pattern)
      const selected = await openDialog({
        filters: [{
          name: 'XML',
          extensions: ['xml']
        }],
        multiple: false
      });

      if (!selected || typeof selected !== 'string') return;

      // Import library via existing Tauri command
      const importedLibrary = await invoke<RegexLibrary>("import_regex_library", {
        importPath: selected
      });

      // Convert all entries from all categories into batch check steps
      const newChecks: any[] = [];
      let currentOrder = profileChecks.length + 1;

      for (const category of importedLibrary.categories) {
        for (const entry of category.entries) {
          newChecks.push({
            order: currentOrder++,
            enabled: true,
            name: entry.name,
            description: entry.description,
            pattern: entry.pattern,
            replacement: entry.replace,
            category: category.name,  // Use category name from XML
            case_sensitive: false,
            exclude_pattern: ""
          });
        }
      }

      // Append to existing checks
      const updatedChecks = [...profileChecks, ...newChecks];
      setProfileChecks(updatedChecks);

      alert(`Imported ${newChecks.length} checks from ${selected}`);
    } catch (err) {
      console.error("Failed to import checks from XML:", err);
      setError(`Failed to import checks: ${err}`);
    }
  }

  async function exportQAProfile() {
    if (!selectedProfile) {
      alert("Please select a profile to export");
      return;
    }

    try {
      const profile = qaProfiles.find(p => p.path === selectedProfile);
      if (!profile) return;

      // Open save dialog
      const filePath = await save({
        filters: [{
          name: 'XML',
          extensions: ['xml']
        }],
        defaultPath: `${profile.name.toLowerCase().replace(/\s+/g, '_')}_qa_profile.xml`
      });

      if (!filePath) return; // User cancelled

      // Export profile via Tauri
      const result = await invoke<string>("export_qa_profile", {
        profilePath: selectedProfile,
        exportPath: filePath
      });

      alert(result);
    } catch (err) {
      console.error("Failed to export profile:", err);
      setError(`Failed to export profile: ${err}`);
    }
  }

  async function importQAProfile() {
    try {
      // Open file dialog
      const selected = await openDialog({
        filters: [{
          name: 'XML',
          extensions: ['xml']
        }],
        multiple: false
      });

      if (!selected || typeof selected !== 'string') return; // User cancelled

      // Import profile via Tauri
      const result = await invoke<string>("import_qa_profile", {
        importPath: selected
      });

      alert(result);

      // Reload profiles list
      await loadQAProfiles();
    } catch (err) {
      console.error("Failed to import profile:", err);
      setError(`Failed to import profile: ${err}`);
    }
  }

  // Highlight matching text in segments
  function highlightMatches(text: string, applyHiddenChars: boolean = false): React.ReactNode {
    if (!searchPattern || !text) return applyHiddenChars ? displayWithHiddenChars(text) : text;

    try {
      const flags = caseSensitive ? 'g' : 'gi';
      let pattern: RegExp;

      if (useRegex) {
        pattern = new RegExp(searchPattern, flags);
      } else {
        // Escape special regex characters for plain text search
        const escapedPattern = searchPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        pattern = new RegExp(escapedPattern, flags);
      }

      // If ignore tags is enabled, extract text segments without tags first
      if (protectTags) {
        const parts: React.ReactElement[] = [];
        let key = 0;

        // Find all tags using comprehensive tag detection
        const tags = extractTags(text);

        // Process text between tags
        for (let i = 0; i <= tags.length; i++) {
          const segmentStart = i === 0 ? 0 : tags[i - 1].end;
          const segmentEnd = i === tags.length ? text.length : tags[i].start;
          const segment = text.substring(segmentStart, segmentEnd);

          // Search in this text segment
          if (segment) {
            const segmentParts: React.ReactElement[] = [];
            let lastIndex = 0;
            let match: RegExpExecArray | null;
            pattern.lastIndex = 0; // Reset pattern

            while ((match = pattern.exec(segment)) !== null) {
              // Add text before match
              if (match.index > lastIndex) {
                const beforeText = segment.substring(lastIndex, match.index);
                segmentParts.push(<span key={`text-${key++}`}>{applyHiddenChars ? displayWithHiddenChars(beforeText) : beforeText}</span>);
              }

              // Add highlighted match
              const matchText = match[0];
              segmentParts.push(
                <mark key={`match-${key++}`} className="search-highlight">
                  {applyHiddenChars ? displayWithHiddenChars(matchText) : matchText}
                </mark>
              );

              lastIndex = match.index + match[0].length;

              // Prevent infinite loop on zero-length matches
              if (match.index === pattern.lastIndex) {
                pattern.lastIndex++;
              }
            }

            // Add remaining text in segment
            if (lastIndex < segment.length) {
              const remainingText = segment.substring(lastIndex);
              segmentParts.push(<span key={`text-${key++}`}>{applyHiddenChars ? displayWithHiddenChars(remainingText) : remainingText}</span>);
            }

            parts.push(...segmentParts);
          }

          // Add tag if exists (without styling for performance)
          if (i < tags.length) {
            parts.push(<span key={`tag-${key++}`}>{tags[i].tag}</span>);
          }
        }

        return parts.length > 0 ? <>{parts}</> : text;
      }

      // Original behavior when tags are not protected
      const parts: React.ReactElement[] = [];
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      let key = 0;

      while ((match = pattern.exec(text)) !== null) {
        // Add text before match
        if (match.index > lastIndex) {
          const beforeText = text.substring(lastIndex, match.index);
          parts.push(<span key={`text-${key++}`}>{applyHiddenChars ? displayWithHiddenChars(beforeText) : beforeText}</span>);
        }

        // Add highlighted match
        const matchText = match[0];
        parts.push(
          <mark key={`match-${key++}`} className="search-highlight">
            {applyHiddenChars ? displayWithHiddenChars(matchText) : matchText}
          </mark>
        );

        lastIndex = match.index + match[0].length;

        // Prevent infinite loop on zero-length matches
        if (match.index === pattern.lastIndex) {
          pattern.lastIndex++;
        }
      }

      // Add remaining text
      if (lastIndex < text.length) {
        const remainingText = text.substring(lastIndex);
        parts.push(<span key={`text-${key++}`}>{applyHiddenChars ? displayWithHiddenChars(remainingText) : remainingText}</span>);
      }

      return parts.length > 0 ? <>{parts}</> : (applyHiddenChars ? displayWithHiddenChars(text) : text);
    } catch {
      // If regex is invalid or other error, return plain text
      return applyHiddenChars ? displayWithHiddenChars(text) : text;
    }
  }

  function discardChanges(e?: React.MouseEvent) {
    // Prevent event bubbling
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (!hasChanges) return;

    const changeCount = editedUnits.size;
    const confirmed = window.confirm(
      `Are you sure you want to discard all ${changeCount} change${changeCount !== 1 ? 's' : ''}? This cannot be undone.`
    );

    if (confirmed) {
      setEditedUnits(new Map());
      clearSelection();
    }
  }

  async function saveFile() {
    if (files.length === 0 || !hasChanges) return;

    try {
      setError("");

      // For multi-file: save each file that has edits
      const savedEdits = new Map(editedUnits);
      let savedCount = 0;

      for (const file of files) {
        // Find edits belonging to this file
        const fileUnitIds = new Set(file.data.trans_units.map(u => u.id));
        const fileEdits = Array.from(savedEdits.entries())
          .filter(([id]) => fileUnitIds.has(id))
          .map(([id, target]) => ({ id, target }));

        if (fileEdits.length === 0) continue;

        await invoke("save_xliff", {
          filePath: file.filePath,
          editedUnits: fileEdits,
          targetLang: file.targetLang || tmxTargetLang
        });
        savedCount++;
      }

      // Update files in memory with edited values
      setFiles(prev => prev.map(file => ({
        ...file,
        data: {
          ...file.data,
          trans_units: file.data.trans_units.map(u =>
            savedEdits.has(u.id) ? { ...u, target: savedEdits.get(u.id)! } : u
          )
        }
      })));

      // Clear edits after successful save
      setEditedUnits(new Map());

      alert(files.length > 1 ? `Saved changes to ${savedCount} file(s)!` : "File saved successfully!");
    } catch (err) {
      setError(`Error saving file: ${err}`);
      console.error(err);
    }
  }

  // Regex library functions
  async function saveLibrary(library?: RegexLibrary) {
    try {
      await invoke("save_regex_library", { library: library || regexLibrary });
    } catch (err) {
      console.error("Failed to save library:", err);
      setError(`Failed to save library: ${err}`);
    }
  }

  function addOrUpdateEntry() {
    if (!newEntryName || !newEntryPattern || !newEntryCategory) {
      alert("Please fill in Name, Pattern, and Category fields");
      return;
    }

    const newLibrary = { ...regexLibrary };
    let targetCategory = newLibrary.categories.find(c => c.name === newEntryCategory);

    if (!targetCategory) {
      // Create new category if it doesn't exist
      targetCategory = { name: newEntryCategory, entries: [] };
      newLibrary.categories.push(targetCategory);
    }

    if (editingEntry) {
      // Update existing entry
      const oldCategory = newLibrary.categories.find(c =>
        c.entries.some(e => e.id === editingEntry.id)
      );
      if (oldCategory) {
        oldCategory.entries = oldCategory.entries.filter(e => e.id !== editingEntry.id);
      }

      targetCategory.entries.push({
        id: editingEntry.id,
        name: newEntryName,
        description: newEntryDescription,
        pattern: newEntryPattern,
        replace: newEntryReplace,
        category: newEntryCategory
      });

      setEditingEntry(null);
    } else {
      // Add new entry
      const newEntry: RegexEntry = {
        id: crypto.randomUUID(),
        name: newEntryName,
        description: newEntryDescription,
        pattern: newEntryPattern,
        replace: newEntryReplace,
        category: newEntryCategory
      };

      targetCategory.entries.push(newEntry);
    }

    setRegexLibrary(newLibrary);
    saveLibrary(newLibrary);

    // Clear form
    setNewEntryName("");
    setNewEntryDescription("");
    setNewEntryPattern("");
    setNewEntryReplace("");
    setNewEntryCategory("");
  }

  function deleteEntry(entryId: string) {
    const confirmed = window.confirm("Are you sure you want to delete this entry?");
    if (!confirmed) {
      return;
    }

    const newLibrary = { ...regexLibrary };
    newLibrary.categories = newLibrary.categories.map(cat => ({
      ...cat,
      entries: cat.entries.filter(e => e.id !== entryId)
    }));

    setRegexLibrary(newLibrary);
    saveLibrary(newLibrary);
  }

  function startEditEntry(entry: RegexEntry) {
    setEditingEntry(entry);
    setNewEntryName(entry.name);
    setNewEntryDescription(entry.description);
    setNewEntryPattern(entry.pattern);
    setNewEntryReplace(entry.replace);
    setNewEntryCategory(entry.category);

    // Scroll to top of modal so the edit form is visible
    setTimeout(() => {
      const modal = document.querySelector('.library-content');
      if (modal) {
        modal.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }, 0);
  }

  function cancelEdit() {
    setEditingEntry(null);
    setNewEntryName("");
    setNewEntryDescription("");
    setNewEntryPattern("");
    setNewEntryReplace("");
    setNewEntryCategory("");
  }

  function applyLibraryEntry(entry: RegexEntry) {
    setSearchPattern(entry.pattern);
    setSearchInput(entry.pattern);
    setReplacePattern(entry.replace);
    setUseRegex(true);
    setShowQuickApply(false);
  }

  // Get all entries flattened for quick apply
  const allLibraryEntries = useMemo(() => {
    return regexLibrary.categories.flatMap(cat => cat.entries);
  }, [regexLibrary]);

  // Filter entries by search term
  const filteredLibraryEntries = useMemo(() => {
    if (!librarySearchTerm) return allLibraryEntries;
    const term = librarySearchTerm.toLowerCase();
    return allLibraryEntries.filter(entry =>
      entry.name.toLowerCase().includes(term) ||
      entry.description.toLowerCase().includes(term) ||
      entry.category.toLowerCase().includes(term)
    );
  }, [allLibraryEntries, librarySearchTerm]);

  // Apply search filter and additional filters — must be after all hooks
  let displayUnits = searchPattern ? filteredUnits : xliffData?.trans_units || [];
  if (showOnlyEdited) {
    displayUnits = displayUnits.filter(unit => editedUnits.has(unit.id));
  }
  if (showOnlyICUErrors) {
    displayUnits = displayUnits.filter(unit => unit.icu_errors && unit.icu_errors.length > 0);
  }
  // When searching with ignore filters active, exclude 100%/locked from results
  if (searchPattern) {
    if (ignore100) {
      displayUnits = displayUnits.filter(unit => !isUnit100(unit));
    }
    if (ignoreLocked) {
      displayUnits = displayUnits.filter(unit => !isUnitLocked(unit));
    }
  }

  // Build display rows: enrich with per-file info and optionally insert file headers
  const displayRows: DisplayRow[] = (() => {
    if (files.length <= 1) {
      // Single file: no headers needed, add DisplayUnit fields
      return displayUnits.map((unit, idx) => ({
        ...unit,
        globalId: `0:${unit.id}`,
        fileIndex: 0,
        fileSegmentNumber: idx + 1,
        fileName: files[0]?.fileName || '',
      } as DisplayUnit));
    }

    // Multi-file: map displayUnits to their DisplayUnit counterparts
    const displayUnitIds = new Set(displayUnits.map(u => u.id));
    const matchedDisplayUnits = allDisplayUnits.filter(du => displayUnitIds.has(du.id));

    if (displayMode === 'merged') {
      // Merged mode: continuous numbering, no headers
      return matchedDisplayUnits.map((du, idx) => ({
        ...du,
        fileSegmentNumber: idx + 1,
      }));
    }

    // Per-file mode: group by fileIndex, insert headers
    const rows: DisplayRow[] = [];
    let currentFileIndex = -1;
    for (const du of matchedDisplayUnits) {
      if (du.fileIndex !== currentFileIndex) {
        currentFileIndex = du.fileIndex;
        const file = files[currentFileIndex];
        if (file) {
          rows.push({
            type: 'fileHeader',
            fileIndex: currentFileIndex,
            fileName: file.fileName,
            stats: file.data.stats,
          });
        }
      }
      rows.push(du);
    }
    return rows;
  })();

  return (
    <div className={`app ${darkMode ? 'dark-mode' : ''} ${retroMode ? 'retro-mode' : ''} ${hackerMode ? 'hacker-mode' : ''}`}>
      <a href="#main-content" className="skip-link">Skip to main content</a>

      {/* 🎮 Easter Egg Badge */}
      {showRetroModeBadge && (
        <div className={hackerMode ? "hacker-mode-badge" : "retro-mode-badge"} style={{whiteSpace: 'pre'}}>
          {easterEggMessage ?
            `╔═════════════════════════╗\n║ ${easterEggMessage.padEnd(23)} ║\n╚═════════════════════════╝`
          :
            `╔═══════════════════╗\n║ RETRO MODE        ║\n║ ACTIVATED!        ║\n╚═══════════════════╝`
          }
        </div>
      )}
      <header className="header">
        <div className="header-left">
          <h1>XLIFF Regex Tool</h1>
        </div>
        <div className="header-right">
          <button
            onClick={() => {
              setShowQAModal(!showQAModal);
              if (!showQAModal) loadQAProfiles();
            }}
            className="qa-checks-btn"
            title="Batch Checks"
          >
            ✓ Batch Checks
          </button>
          <button
            onClick={() => setSimplifyTags(!simplifyTags)}
            className={`simplify-tags-btn${simplifyTags ? ' active' : ''}`}
            aria-label={simplifyTags ? "Show full tags" : "Simplify tags to numbered placeholders"}
            title={simplifyTags ? "Show full tags" : "Simplify tags to numbered placeholders"}
          >
            &lt;1&gt;
          </button>
          <button
            onClick={() => setShowHiddenChars(!showHiddenChars)}
            className="hidden-chars-btn"
            aria-label={showHiddenChars ? "Hide hidden characters" : "Show hidden characters"}
            title={showHiddenChars ? "Hide hidden characters" : "Show hidden characters (spaces, line breaks, tabs)"}
          >
            ¶
          </button>
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="theme-toggle-btn"
            aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          >
            {darkMode ? '☀️' : '🌙'}
          </button>
          <button onClick={openFile} className="open-btn" title="Open XLIFF file (Ctrl/Cmd+O)">
            Open XLIFF
          </button>
          {hasChanges && (
            <>
              <button onClick={discardChanges} className="discard-btn" title="Discard all changes">
                Discard Changes
              </button>
              <button onClick={saveFile} className="save-btn">
                Save Changes ({editedUnits.size})
              </button>
            </>
          )}
        </div>
      </header>

      {/* TMX Language Picker Modal */}
      {showTmxLangPicker && (
        <div className="library-modal-overlay" role="presentation">
          <div className="library-modal" role="dialog" aria-modal="true" aria-label="Select target language">
            <div className="library-modal-header">
              <h2>Select Target Language</h2>
            </div>
            <div className="library-modal-body" style={{ padding: '1.5rem' }}>
              <p>This TMX file contains multiple target languages. Select which one to use as the translation target.</p>
              <p style={{ fontSize: '0.85rem', color: '#666' }}>Source language: <strong>{tmxSrcLang}</strong></p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
                {tmxAvailableLangs.map(lang => (
                  <label key={lang} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', padding: '0.5rem', border: '1px solid #ddd', borderRadius: '4px' }}>
                    <input
                      type="radio"
                      name="tmxLang"
                      value={lang}
                      onChange={() => setTmxTargetLang(lang)}
                      checked={tmxTargetLang === lang}
                    />
                    {lang}
                  </label>
                ))}
              </div>
            </div>
            <div className="library-modal-footer">
              <button
                onClick={async () => {
                  if (!tmxTargetLang) return;
                  setShowTmxLangPicker(false);
                  setError("");
                  setEditedUnits(new Map());
                  clearSelection();
                  try {
                    const data = await invoke<XliffData>("open_xliff", { filePath: pendingTmxPath, targetLang: tmxTargetLang });
                    setSingleFile(pendingTmxPath, data, tmxTargetLang);
                  } catch (err) {
                    setError(`Error opening TMX file: ${err}`);
                  }
                }}
                disabled={!tmxTargetLang}
                className="apply-btn"
              >
                Open
              </button>
              <button onClick={() => { setShowTmxLangPicker(false); setPendingTmxPath(""); }} className="cancel-btn">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Help Modal */}
      {showHelpModal && (
        <div className="library-modal-overlay" onClick={() => setShowHelpModal(false)} role="presentation">
          <div ref={helpModalRef} className="library-modal help-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="help-modal-title">
            <div className="library-header">
              <h2 id="help-modal-title">Keyboard Shortcuts</h2>
              <button onClick={() => setShowHelpModal(false)} className="close-library-btn" aria-label="Close help modal">
                ✕
              </button>
            </div>
            <div className="help-content">
              <div className="shortcuts-section">
                <h3>File Operations</h3>
                <div className="shortcut-list">
                  <div className="shortcut-item">
                    <kbd>Ctrl/Cmd + O</kbd>
                    <span>Open XLIFF file</span>
                  </div>
                  <div className="shortcut-item">
                    <kbd>Ctrl/Cmd + S</kbd>
                    <span>Save changes</span>
                  </div>
                </div>
              </div>

              <div className="shortcuts-section">
                <h3>Search & Replace</h3>
                <div className="shortcut-list">
                  <div className="shortcut-item">
                    <kbd>Ctrl/Cmd + F</kbd>
                    <span>Focus search field</span>
                  </div>
                </div>
              </div>

              <div className="shortcuts-section">
                <h3>Tools</h3>
                <div className="shortcut-list">
                  <div className="shortcut-item">
                    <kbd>Ctrl/Cmd + L</kbd>
                    <span>Open Regex Library</span>
                  </div>
                  <div className="shortcut-item">
                    <kbd>Ctrl/Cmd + Q</kbd>
                    <span>Open Batch Check Profiles</span>
                  </div>
                </div>
              </div>

              <div className="shortcuts-section">
                <h3>Navigation</h3>
                <div className="shortcut-list">
                  <div className="shortcut-item">
                    <kbd>Ctrl/Cmd + ↑</kbd>
                    <span>Jump to first segment</span>
                  </div>
                  <div className="shortcut-item">
                    <kbd>Ctrl/Cmd + ↓</kbd>
                    <span>Jump to last segment</span>
                  </div>
                </div>
              </div>

              <div className="shortcuts-section">
                <h3>General</h3>
                <div className="shortcut-list">
                  <div className="shortcut-item">
                    <kbd>Esc</kbd>
                    <span>Close modals / Exit edit mode</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* User Guide Modal */}
      {showUserGuideModal && (
        <div className="library-modal-overlay" onClick={() => setShowUserGuideModal(false)} role="presentation">
          <div
            ref={userGuideModalRef}
            className="library-modal user-guide-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '95vw', width: '1200px', maxHeight: '90vh' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-guide-title"
          >
            <div className="library-header">
              <h2 id="user-guide-title">User Guide</h2>
              <button onClick={() => setShowUserGuideModal(false)} className="close-library-btn" aria-label="Close user guide">
                ✕
              </button>
            </div>
            <div
              style={{
                height: 'calc(90vh - 60px)',
                overflow: 'auto',
                padding: '1rem',
                backgroundColor: 'white',
                color: 'black'
              }}
            >
              {userGuideContent ? (
                <div dangerouslySetInnerHTML={{ __html: userGuideContent }} />
              ) : (
                <div style={{ padding: '2rem', textAlign: 'center' }}>
                  <p>Loading User Guide...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Changelog Modal */}
      {showChangelogModal && (
        <div className="library-modal-overlay" onClick={() => setShowChangelogModal(false)} role="presentation">
          <div
            ref={changelogModalRef}
            className="library-modal user-guide-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '95vw', width: '1200px', maxHeight: '90vh' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="changelog-title"
          >
            <div className="library-header">
              <h2 id="changelog-title">Changelog</h2>
              <button onClick={() => setShowChangelogModal(false)} className="close-library-btn" aria-label="Close changelog">
                ✕
              </button>
            </div>
            <div
              style={{
                height: 'calc(90vh - 60px)',
                overflow: 'auto',
                padding: '1rem',
                backgroundColor: 'white',
                color: 'black'
              }}
            >
              {changelogContent ? (
                <div dangerouslySetInnerHTML={{ __html: changelogContent }} />
              ) : (
                <div style={{ padding: '2rem', textAlign: 'center', color: 'black' }}>
                  <p>Loading Changelog...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* About Modal */}
      {showAboutModal && (
        <div className="library-modal-overlay" onClick={() => setShowAboutModal(false)} role="presentation">
          <div ref={aboutModalRef} className="library-modal about-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="about-modal-title">
            <div className="library-header">
              <h2 id="about-modal-title">About XLIFF Regex Tool</h2>
              <button onClick={() => setShowAboutModal(false)} className="close-library-btn" aria-label="Close about dialog">
                ✕
              </button>
            </div>
            <div className="about-content">
              <div className="about-logo">
                <h1>XLIFF Regex Tool</h1>
              </div>
              <div className="about-info">
                <p className="version">Version 0.5.1</p>
                <p className="description">
                  A powerful Find & Replace tool for XLIFF translation files with regex support,
                  batch check profiles, and batch processing capabilities.
                </p>
                <p className="copyright">
                  © 2026 Håvard Nørjordet
                </p>
                <p className="tech-stack">
                  Built with Tauri, React, TypeScript, and Python
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Update Available Dialog */}
      {updateAvailable && (
        <div className="library-modal-overlay" onClick={() => setUpdateAvailable(false)} role="presentation">
          <div className="library-modal update-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="update-modal-title">
            <div className="library-header">
              <h2 id="update-modal-title">🎉 Oppdatering Tilgjengelig!</h2>
              <button onClick={() => setUpdateAvailable(false)} className="close-library-btn" aria-label="Close update dialog">
                ✕
              </button>
            </div>
            <div className="update-content" style={{ padding: '1.5rem' }}>
              <p style={{ marginBottom: '1rem' }}>
                <strong>Ny versjon:</strong> {updateVersion}
              </p>
              <div style={{
                padding: '1rem',
                background: '#f5f5f5',
                borderRadius: '4px',
                maxHeight: '300px',
                overflow: 'auto',
                marginBottom: '1.5rem'
              }}>
                <pre style={{
                  whiteSpace: 'pre-wrap',
                  fontSize: '0.9em',
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                  lineHeight: '1.5',
                  margin: 0
                }}>
                  {updateNotes}
                </pre>
              </div>
              <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setUpdateAvailable(false)}
                  disabled={isDownloadingUpdate}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '4px',
                    border: '1px solid #ccc',
                    background: 'white',
                    cursor: isDownloadingUpdate ? 'not-allowed' : 'pointer'
                  }}
                >
                  Installer Senere
                </button>
                <button
                  onClick={installUpdate}
                  disabled={isDownloadingUpdate}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '4px',
                    border: 'none',
                    background: isDownloadingUpdate ? '#9ca3af' : '#2563eb',
                    color: 'white',
                    cursor: isDownloadingUpdate ? 'not-allowed' : 'pointer',
                    fontWeight: '500'
                  }}
                >
                  {isDownloadingUpdate ? '⏳ Laster ned...' : '✅ Installer Nå'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="library-modal-overlay" onClick={() => setShowSettingsModal(false)} role="presentation">
          <div ref={settingsModalRef} className="library-modal settings-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
            <div className="library-header">
              <h2 id="settings-modal-title">Settings</h2>
              <button onClick={() => setShowSettingsModal(false)} className="close-library-btn" aria-label="Close settings">
                ✕
              </button>
            </div>
            <div className="settings-content">
              <div className="settings-section">
                <h3>Storage Paths</h3>
                <p className="settings-description">
                  Configure where XML files are stored. Leave empty to use default locations.
                </p>

                <div className="settings-form">
                  <div className="form-group">
                    <label htmlFor="regex-library-path">Regex Library Path</label>
                    <input
                      id="regex-library-path"
                      type="text"
                      value={settingsRegexLibraryPath}
                      onChange={(e) => setSettingsRegexLibraryPath(e.target.value)}
                      placeholder="Default: ~/.xliff-regex-tool/regex-library.xml"
                      className="settings-input"
                    />
                    <p className="settings-hint">
                      Path to the regex library XML file
                    </p>
                  </div>

                  <div className="form-group">
                    <label htmlFor="qa-profiles-path">Batch Check Profiles Directory</label>
                    <input
                      id="qa-profiles-path"
                      type="text"
                      value={settingsQAProfilesPath}
                      onChange={(e) => setSettingsQAProfilesPath(e.target.value)}
                      placeholder="Default: ./samples/"
                      className="settings-input"
                    />
                    <p className="settings-hint">
                      Directory where Batch Check profile XML files are stored
                    </p>
                  </div>
                </div>
              </div>

              <div className="settings-section">
                <h3>View Options</h3>
                <div className="settings-toggles">
                  <label className="settings-toggle-label">
                    <input
                      type="checkbox"
                      checked={showHiddenChars}
                      onChange={(e) => setShowHiddenChars(e.target.checked)}
                    />
                    <span>Show Hidden Characters</span>
                  </label>
                  <div className="settings-theme-group">
                    <span className="settings-theme-label">Theme:</span>
                    <label className="settings-toggle-label">
                      <input
                        type="radio"
                        name="themeMode"
                        value="light"
                        checked={themeMode === 'light'}
                        onChange={() => setThemeMode('light')}
                      />
                      <span>Light</span>
                    </label>
                    <label className="settings-toggle-label">
                      <input
                        type="radio"
                        name="themeMode"
                        value="dark"
                        checked={themeMode === 'dark'}
                        onChange={() => setThemeMode('dark')}
                      />
                      <span>Dark</span>
                    </label>
                    <label className="settings-toggle-label">
                      <input
                        type="radio"
                        name="themeMode"
                        value="system"
                        checked={themeMode === 'system'}
                        onChange={() => setThemeMode('system')}
                      />
                      <span>System</span>
                    </label>
                  </div>
                </div>
              </div>

              {files.length > 1 && (
                <div className="settings-section">
                  <h3>Multi-File Display</h3>
                  <p className="settings-description">
                    Choose how multiple loaded files are displayed in the grid.
                  </p>
                  <div className="settings-toggles">
                    <label className="settings-toggle-label">
                      <input
                        type="radio"
                        name="displayMode"
                        value="perFile"
                        checked={displayMode === 'perFile'}
                        onChange={() => setDisplayMode('perFile')}
                      />
                      <span>Per file — show filename headers, numbering restarts per file</span>
                    </label>
                    <label className="settings-toggle-label">
                      <input
                        type="radio"
                        name="displayMode"
                        value="merged"
                        checked={displayMode === 'merged'}
                        onChange={() => setDisplayMode('merged')}
                      />
                      <span>Merged — continuous numbering, no file headers</span>
                    </label>
                  </div>
                </div>
              )}

              <div className="settings-section">
                <h3>TMS Integration</h3>
                <p className="settings-description">
                  Configure Translation Management System integration for supported XLIFF files.
                </p>
                <div className="settings-toggles">
                  <label className="settings-toggle-label">
                    <input
                      type="checkbox"
                      checked={tmsAutoCopy}
                      onChange={(e) => setTmsAutoCopy(e.target.checked)}
                    />
                    <span>Auto-copy edited text when opening in TMS</span>
                  </label>
                </div>
                <p className="settings-hint">
                  Supported TMS: Lingotek, Phrase/Memsource
                </p>
              </div>

              <div className="settings-actions">
                <button onClick={() => setShowSettingsModal(false)} className="settings-close-btn">
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Regex Library Modal */}
      {showLibraryModal && (
        <div className="library-modal-overlay" onClick={() => setShowLibraryModal(false)} role="presentation">
          <div ref={libraryModalRef} className="library-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="library-modal-title">
            <div className="library-header">
              <h2 id="library-modal-title">Regex Library</h2>
              <div className="library-header-actions">
                <button onClick={exportRegexLibrary} className="export-library-btn" title="Export library to XML file">
                  Export
                </button>
                <button onClick={importRegexLibrary} className="import-library-btn" title="Import library from XML file">
                  Import
                </button>
                <button onClick={() => setShowLibraryModal(false)} className="close-library-btn" aria-label="Close regex library">
                  ✕
                </button>
              </div>
            </div>

            <div className="library-content">
              {/* Entry Form */}
              <div className="library-form">
                <h3>{editingEntry ? 'Edit Entry' : 'Add New Entry'}</h3>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="entry-category">Category</label>
                    <select
                      id="entry-category"
                      value={newEntryCategory}
                      onChange={(e) => setNewEntryCategory(e.target.value)}
                    >
                      <option value="">Select or type new...</option>
                      {regexLibrary.categories.map(cat => (
                        <option key={cat.name} value={cat.name}>{cat.name}</option>
                      ))}
                    </select>
                    <input
                      id="entry-category-input"
                      type="text"
                      placeholder="Or enter new category"
                      value={newEntryCategory}
                      onChange={(e) => setNewEntryCategory(e.target.value)}
                      className="category-input"
                      aria-label="Enter new category"
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="entry-name">Name</label>
                    <input
                      id="entry-name"
                      type="text"
                      placeholder="Short name for this pattern"
                      value={newEntryName}
                      onChange={(e) => setNewEntryName(e.target.value)}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="entry-description">Description</label>
                  <input
                    id="entry-description"
                    type="text"
                    placeholder="Longer explanation (e.g., 'Replaces x with y, example: 1000kr → 1 000 kr')"
                    value={newEntryDescription}
                    onChange={(e) => setNewEntryDescription(e.target.value)}
                  />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="entry-pattern">
                      Pattern (Regex)
                      {newEntryPattern && (
                        <span className="regex-validation">
                          {validateRegex(newEntryPattern).valid ? (
                            <span className="validation-success" title="Valid regex">✓</span>
                          ) : (
                            <span className="validation-error" title={validateRegex(newEntryPattern).error}>
                              ✗ <span className="error-icon">ⓘ</span>
                            </span>
                          )}
                        </span>
                      )}
                    </label>
                    <input
                      id="entry-pattern"
                      type="text"
                      placeholder="Regex pattern"
                      value={newEntryPattern}
                      onChange={(e) => setNewEntryPattern(e.target.value)}
                      className={newEntryPattern ? (validateRegex(newEntryPattern).valid ? 'valid-regex' : 'invalid-regex') : ''}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="entry-replace">Replace</label>
                    <input
                      id="entry-replace"
                      type="text"
                      placeholder="Replacement string"
                      value={newEntryReplace}
                      onChange={(e) => setNewEntryReplace(e.target.value)}
                    />
                  </div>
                </div>
                <div className="form-actions">
                  <button onClick={addOrUpdateEntry} className="add-entry-btn">
                    {editingEntry ? 'Update Entry' : 'Add Entry'}
                  </button>
                  {editingEntry && (
                    <button onClick={cancelEdit} className="cancel-edit-btn">
                      Cancel
                    </button>
                  )}
                </div>
              </div>

              {/* Entries List */}
              <div className="library-list">
                <h3>Saved Patterns</h3>
                {regexLibrary.categories.map(category => (
                  category.entries.length > 0 && (
                    <div key={category.name} className="library-category">
                      <h4>{category.name}</h4>
                      {category.entries.map(entry => (
                        <div key={entry.id} className="library-entry">
                          <div className="entry-info">
                            <div className="entry-name">{entry.name}</div>
                            {entry.description && (
                              <div className="entry-description">{entry.description}</div>
                            )}
                            <div className="entry-pattern">
                              <code>{entry.pattern}</code> → <code>{entry.replace}</code>
                            </div>
                          </div>
                          <div className="entry-actions">
                            <button
                              onClick={() => startEditEntry(entry)}
                              className="edit-entry-btn"
                              aria-label={`Edit ${entry.name}`}
                              title="Edit"
                            >
                              ✎
                            </button>
                            <button
                              onClick={() => deleteEntry(entry.id)}
                              className="delete-entry-btn"
                              aria-label={`Delete ${entry.name}`}
                              title="Delete"
                            >
                              🗑
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ))}
                {allLibraryEntries.length === 0 && (
                  <p className="empty-library">No entries yet. Add your first regex pattern above!</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Special Characters Menu */}
      {showSpecialCharsMenu && (
        <div className="special-chars-menu">
          <h3>Insert Special Character</h3>
          <div className="special-chars-grid">
            <button onClick={() => insertSpecialChar('\u00A0', 'search')} title="Non-breaking space">
              NBSP (hard space)
            </button>
            <button onClick={() => insertSpecialChar('\t', 'search')} title="Tab character">
              Tab
            </button>
            <button onClick={() => insertSpecialChar('\n', 'search')} title="Line break">
              Line Break
            </button>
            <button onClick={() => insertSpecialChar('\u2013', 'search')} title="En dash">
              – (En dash)
            </button>
            <button onClick={() => insertSpecialChar('\u2014', 'search')} title="Em dash">
              — (Em dash)
            </button>
            <button onClick={() => insertSpecialChar('\u00AB', 'search')} title="Left guillemet">
              « (Guillemet left)
            </button>
            <button onClick={() => insertSpecialChar('\u00BB', 'search')} title="Right guillemet">
              » (Guillemet right)
            </button>
            <button onClick={() => insertSpecialChar('\u2019', 'search')} title="Right single quotation mark">
              ' (Smart quote)
            </button>
            <button onClick={() => insertSpecialChar('\u201C', 'search')} title="Left double quotation mark">
              " (Smart quote left)
            </button>
            <button onClick={() => insertSpecialChar('\u201D', 'search')} title="Right double quotation mark">
              " (Smart quote right)
            </button>
            <button onClick={() => insertSpecialChar('\u2022', 'search')} title="Bullet point">
              • (Bullet)
            </button>
            <button onClick={() => insertSpecialChar('\u2026', 'search')} title="Ellipsis">
              … (Ellipsis)
            </button>
          </div>
          <p className="special-chars-note">Click a character to insert into search field</p>
          <button onClick={() => setShowSpecialCharsMenu(false)} className="close-menu-btn">
            Close
          </button>
        </div>
      )}

      {/* Batch Check Profile Manager Modal */}
      {showProfileManager && (
        <div className="library-modal-overlay" onClick={() => setShowProfileManager(false)} role="presentation">
          <div ref={profileManagerRef} className="library-modal qa-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="qa-profiles-title">
            <div className="library-header">
              <h2 id="qa-profiles-title">Batch Check Profiles</h2>
              <div className="header-actions">
                <button onClick={importQAProfile} className="import-library-btn" title="Import profile from XML file">
                  Import
                </button>
                <button onClick={createNewProfile} className="manage-profiles-btn" title="Create New Profile">
                  ➕ New Profile
                </button>
                <button onClick={() => setShowProfileManager(false)} className="close-library-btn" aria-label="Close profile manager">
                  ✕
                </button>
              </div>
            </div>

            <div className="qa-content">
              {/* Profile List */}
              <div className="qa-profile-selector">
                <h3>Available Profiles</h3>
                {qaProfiles.length === 0 ? (
                  <p className="no-profiles">No profiles found. Click "New Profile" to create one.</p>
                ) : (
                  <div className="profile-list">
                    {qaProfiles.map((profile) => (
                      <div key={profile.path} className="profile-card">
                        <div className="profile-card-header">
                          <h4>{profile.name}</h4>
                          {profile.language && <span className="profile-language">{profile.language}</span>}
                        </div>
                        {profile.description && (
                          <p className="profile-card-description">{profile.description}</p>
                        )}
                        <div className="profile-card-actions">
                          <button
                            onClick={() => editProfile(profile)}
                            className="edit-profile-btn"
                            title="Edit this profile"
                          >
                            ✏️ Edit
                          </button>
                          <button
                            onClick={async () => {
                              setSelectedProfile(profile.path);
                              // Wait a bit for state to update, then export
                              setTimeout(async () => {
                                await exportQAProfile();
                              }, 100);
                            }}
                            className="export-profile-btn"
                            title="Export this profile"
                          >
                            📤 Export
                          </button>
                          <button
                            onClick={() => deleteProfile(profile)}
                            className="delete-profile-btn"
                            title="Delete this profile"
                          >
                            🗑️ Delete
                          </button>
                          <button
                            onClick={() => {
                              setSelectedProfile(profile.path);
                              setShowProfileManager(false);
                              setShowQAModal(true);
                            }}
                            className="run-profile-btn"
                            title="Run this profile"
                          >
                            ▶️ Run
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batch Checks Modal */}
      {showQAModal && (
        <div className="library-modal-overlay" onClick={() => setShowQAModal(false)} role="presentation">
          <div ref={qaModalRef} className="library-modal qa-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="qa-checks-title">
            <div className="library-header">
              <h2 id="qa-checks-title">Batch Checks</h2>
              <div className="header-actions">
                <button onClick={createNewProfile} className="manage-profiles-btn" title="Manage Batch Check Profiles">
                  ⚙️ Manage Profiles
                </button>
                <button onClick={() => setShowQAModal(false)} className="close-library-btn" aria-label="Close batch checks">
                  ✕
                </button>
              </div>
            </div>

            <div className="qa-content">
              {/* Profile Selector */}
              <div className="qa-profile-selector">
                <div className="profile-selector-header">
                  <h3>Select Profile</h3>
                  {selectedProfile && (
                    <button
                      onClick={() => {
                        const profile = qaProfiles.find(p => p.path === selectedProfile);
                        if (profile) editProfile(profile);
                      }}
                      className="edit-profile-btn"
                      title="Edit this profile"
                    >
                      ✏️ Edit
                    </button>
                  )}
                </div>
                <select
                  value={selectedProfile}
                  onChange={(e) => setSelectedProfile(e.target.value)}
                  className="qa-profile-select"
                  disabled={qaIsRunning}
                >
                  {qaProfiles.length === 0 && (
                    <option value="">No profiles found</option>
                  )}
                  {qaProfiles.map((profile) => (
                    <option key={profile.path} value={profile.path}>
                      {profile.name} {profile.language && `(${profile.language})`}
                    </option>
                  ))}
                </select>
                {selectedProfile && qaProfiles.find(p => p.path === selectedProfile) && (
                  <p className="profile-description">
                    {qaProfiles.find(p => p.path === selectedProfile)?.description}
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="qa-actions">
                <button
                  onClick={runBatchChecks}
                  disabled={!filePath || !selectedProfile || qaIsRunning}
                  className="run-checks-btn"
                >
                  {qaIsRunning ? 'Running...' : '🔍 Run Checks'}
                </button>
                {qaIsRunning && (
                  <div role="status" aria-live="polite" style={{ padding: '8px', fontSize: '14px', color: 'var(--text-secondary)' }}>
                    Running checks...
                  </div>
                )}
                {qaBatchResults && qaBatchResults.total_matches > 0 && (
                  <>
                    <button
                      onClick={runBatchReplace}
                      disabled={qaIsRunning}
                      className="replace-all-btn"
                      title="Apply all fixes directly to file on disk (no review)"
                    >
                      Replace All (direct)
                    </button>
                    <div className="qa-select-controls">
                      <button onClick={() => toggleAllMatches(true)} className="select-all-btn">
                        Select All
                      </button>
                      <button onClick={() => toggleAllMatches(false)} className="deselect-all-btn">
                        Deselect All
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Results Display */}
              {qaBatchResults && (
                <div className="qa-results" role="region" aria-label="Batch check results">
                  <div className="qa-results-header">
                    <h3 role="status" aria-live="polite">
                      Results: {qaBatchResults.total_matches} issue{qaBatchResults.total_matches !== 1 ? 's' : ''} found
                    </h3>
                    {qaBatchResults.total_matches > 0 && (
                      <button
                        onClick={stageBatchFixes}
                        disabled={qaIsRunning || selectedMatches.size === 0}
                        className="stage-fixes-btn"
                        title="Stage selected fixes as pending edits — review before saving"
                      >
                        Stage {selectedMatches.size} fix{selectedMatches.size !== 1 ? 'es' : ''}
                      </button>
                    )}
                  </div>

                  {qaBatchResults.total_matches === 0 ? (
                    <div className="no-issues" role="status" aria-live="polite">
                      ✓ No issues found! Your file looks good.
                    </div>
                  ) : (
                    <div className="qa-matches-list">
                      {/* Group by check type, preserving global index for stable IDs */}
                      {Object.entries(
                        qaBatchResults.matches.reduce((groups: any, match: any, globalIdx: number) => {
                          const key = match.check_name;
                          if (!groups[key]) {
                            groups[key] = {
                              name: match.check_name,
                              category: match.category,
                              description: match.description,
                              matches: []
                            };
                          }
                          groups[key].matches.push({ ...match, globalIdx });
                          return groups;
                        }, {})
                      ).map(([checkName, group]: [string, any]) => (
                        <div key={checkName} className="qa-check-group">
                          <div className="qa-check-header">
                            <h4>{group.name}</h4>
                            <span className="qa-check-count">{group.matches.length} match{group.matches.length !== 1 ? 'es' : ''}</span>
                          </div>
                          <p className="qa-check-description">{group.description}</p>
                          <div className="qa-matches">
                            {group.matches.map((match: any) => {
                              const matchId = `${match.tu_id}-${match.check_name}-${match.globalIdx}`;
                              const isSelected = selectedMatches.has(matchId);

                              return (
                                <div key={matchId} className={`qa-match-item ${isSelected ? 'selected' : 'deselected'}`}>
                                  <div className="qa-match-checkbox">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => toggleMatchSelection(matchId)}
                                      id={`match-${matchId}`}
                                    />
                                    <label htmlFor={`match-${matchId}`}></label>
                                  </div>
                                  <div className="qa-match-content">
                                    <div className="qa-match-header">
                                      <span className="qa-match-tu">TU: {(() => {
                                        // Convert MXLIFF format (abc:0) to display number (1)
                                        if (match.tu_id.includes(':')) {
                                          const numAfterColon = match.tu_id.split(':').pop();
                                          if (numAfterColon && /^\d+$/.test(numAfterColon)) {
                                            return String(parseInt(numAfterColon, 10) + 1);
                                          }
                                        }
                                        return match.tu_id;
                                      })()}</span>
                                      <span className="qa-match-text">"{match.match}"</span>
                                      <span className="qa-match-pos">(pos {match.match_start}-{match.match_end})</span>
                                    </div>
                                    <div className="qa-match-segment">
                                      <div className="qa-segment-label">Target:</div>
                                      <div className="qa-segment-text">{match.target}</div>
                                    </div>
                                    {match.replacement && (
                                      <div className="qa-match-fix">
                                        → Will replace with: "<span className="replacement-preview">{match.replacement}</span>"
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!qaBatchResults && !qaIsRunning && (
                <div className="qa-help">
                  <p>💡 Select a profile and click "Run Checks" to find issues in your file.</p>
                  <p>If issues are found, you can review them and click "Replace All" to fix them automatically.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Batch Check Profile Editor Modal */}
      {showProfileEditor && (
        <div className="library-modal-overlay" onClick={() => setShowProfileEditor(false)} role="presentation">
          <div ref={profileEditorRef} className="library-modal profile-editor-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="profile-editor-title">
            <div className="library-header">
              <h2 id="profile-editor-title">{editingProfile ? 'Edit Batch Check Profile' : 'New Batch Check Profile'}</h2>
              <button onClick={() => setShowProfileEditor(false)} className="close-library-btn" aria-label="Close profile editor">
                ✕
              </button>
            </div>

            <div className="profile-editor-content">
              {/* Profile Metadata */}
              <div className="profile-metadata">
                <div className="form-group">
                  <label htmlFor="profile-name">Profile Name *</label>
                  <input
                    id="profile-name"
                    type="text"
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    placeholder="e.g., Norwegian Batch Checks"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="profile-description">Description</label>
                  <textarea
                    id="profile-description"
                    value={profileDescription}
                    onChange={(e) => setProfileDescription(e.target.value)}
                    placeholder="Describe what this profile checks for..."
                    rows={3}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="profile-language">Language Code</label>
                  <input
                    id="profile-language"
                    type="text"
                    value={profileLanguage}
                    onChange={(e) => setProfileLanguage(e.target.value)}
                    placeholder="e.g., no, en, sv"
                  />
                </div>
              </div>

              {/* Add Pattern from Library */}
              <div className="add-pattern-section">
                <h3>Add Check from Regex Library</h3>
                <div className="library-patterns-grid">
                  {regexLibrary.categories.map(category => (
                    category.entries.length > 0 && (
                      <div key={category.name} className="category-section">
                        <h4>{category.name}</h4>
                        {category.entries.map(entry => (
                          <div key={entry.id} className="pattern-add-item">
                            <div className="pattern-info">
                              <strong>{entry.name}</strong>
                              {entry.description && <p>{entry.description}</p>}
                            </div>
                            <button
                              onClick={() => addPatternFromLibrary(entry)}
                              className="add-pattern-btn"
                              title="Add to profile"
                            >
                              +
                            </button>
                          </div>
                        ))}
                      </div>
                    )
                  ))}
                </div>
              </div>

              {/* Checks List */}
              <div className="profile-checks-section">
                <div className="checks-header">
                  <h3>Checks ({profileChecks.length})</h3>
                  <div className="checks-header-buttons">
                    <button onClick={addCheckToProfile} className="add-check-btn">
                      + Add Custom Check
                    </button>
                    <button onClick={importChecksFromXML} className="import-checks-btn" title="Import checks from XML file">
                      Import from XML
                    </button>
                  </div>
                </div>

                {profileChecks.length === 0 ? (
                  <div className="no-checks">
                    No checks added yet. Click "+ Add Custom Check" or add patterns from the library above.
                  </div>
                ) : (
                  <div className="checks-list">
                    {profileChecks.map((check, index) => (
                      <div key={index} className="check-editor-item">
                        <div className="check-order">
                          <div className="order-number">#{check.order}</div>
                          <div className="order-controls">
                            <button
                              onClick={() => moveCheckUp(index)}
                              disabled={index === 0}
                              title="Move up"
                              className="move-btn"
                            >
                              ↑
                            </button>
                            <button
                              onClick={() => moveCheckDown(index)}
                              disabled={index === profileChecks.length - 1}
                              title="Move down"
                              className="move-btn"
                            >
                              ↓
                            </button>
                          </div>
                        </div>

                        <div className="check-fields">
                          <div className="check-row">
                            <div className="form-group flex-1">
                              <label htmlFor={`check-name-${index}`}>Check Name</label>
                              <input
                                id={`check-name-${index}`}
                                type="text"
                                value={check.name}
                                onChange={(e) => updateCheck(index, 'name', e.target.value)}
                                placeholder="e.g., Multiple spaces"
                              />
                            </div>
                            <div className="check-toggle">
                              <label htmlFor={`check-enabled-${index}`}>
                                <input
                                  id={`check-enabled-${index}`}
                                  type="checkbox"
                                  checked={check.enabled}
                                  onChange={(e) => updateCheck(index, 'enabled', e.target.checked)}
                                />
                                Enabled
                              </label>
                            </div>
                          </div>

                          <div className="form-group">
                            <label htmlFor={`check-description-${index}`}>Description</label>
                            <input
                              id={`check-description-${index}`}
                              type="text"
                              value={check.description}
                              onChange={(e) => updateCheck(index, 'description', e.target.value)}
                              placeholder="What does this check do?"
                            />
                          </div>

                          <div className="form-row">
                            <div className="form-group flex-1">
                              <label htmlFor={`check-pattern-${index}`}>Pattern</label>
                              <input
                                id={`check-pattern-${index}`}
                                type="text"
                                value={check.pattern}
                                onChange={(e) => updateCheck(index, 'pattern', e.target.value)}
                                placeholder="Regex pattern"
                                className="monospace"
                              />
                            </div>
                            <div className="form-group flex-1">
                              <label htmlFor={`check-replacement-${index}`}>Replacement</label>
                              <input
                                id={`check-replacement-${index}`}
                                type="text"
                                value={check.replacement}
                                onChange={(e) => updateCheck(index, 'replacement', e.target.value)}
                                placeholder="Replacement text"
                                className="monospace"
                              />
                            </div>
                          </div>

                          <div className="form-row">
                            <div className="form-group flex-1">
                              <label htmlFor={`check-category-${index}`}>Category</label>
                              <input
                                id={`check-category-${index}`}
                                type="text"
                                value={check.category}
                                onChange={(e) => updateCheck(index, 'category', e.target.value)}
                                placeholder="e.g., Whitespace"
                              />
                            </div>
                            <div className="form-group flex-1">
                              <label htmlFor={`check-exclude-${index}`}>Exclude Pattern (optional)</label>
                              <input
                                id={`check-exclude-${index}`}
                                type="text"
                                value={check.exclude_pattern}
                                onChange={(e) => updateCheck(index, 'exclude_pattern', e.target.value)}
                                placeholder="e.g., ^(19|20)\d{2}$"
                                className="monospace"
                              />
                            </div>
                          </div>
                        </div>

                        <div className="check-actions">
                          <button onClick={() => removeCheck(index)} className="remove-check-btn" title="Remove check">
                            🗑️
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Save Button */}
              <div className="editor-footer">
                <button onClick={() => setShowProfileEditor(false)} className="cancel-btn">
                  Cancel
                </button>
                <button onClick={saveProfile} className="save-profile-btn">
                  Save Profile
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="error" role="alert" aria-live="assertive">
          {error}
        </div>
      )}

      {files.length > 0 && (
        <div className="file-info">
          <strong>{files.length > 1 ? 'Files:' : 'File:'}</strong>{' '}
          {files.length === 1 ? files[0].filePath : `${files.length} files loaded (${files.map(f => f.fileName).join(', ')})`}
          {files.length === 1 && files[0].filePath.toLowerCase().endsWith('.tmx') && (
            <span className="tmx-badge" title={tmxTargetLang ? `Target language: ${tmxTargetLang}` : "TMX file"}>
              TMX{tmxTargetLang ? ` · ${tmxTargetLang}` : ''}
            </span>
          )}
        </div>
      )}

      {xliffData && (
        <div className={`content${selectedSegmentId ? ' editor-open' : ''}`} id="main-content">
          <div className="stats">
            <div className="stat-item">
              <span className="stat-label">Total Units:</span>
              <span className="stat-value">{xliffData.stats.total_units}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Translated:</span>
              <span className="stat-value">{xliffData.stats.translated}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Untranslated:</span>
              <span className="stat-value">{xliffData.stats.untranslated}</span>
            </div>
            {searchPattern && (
              <div className="stat-item">
                <span className="stat-label">Matches:</span>
                <span className="stat-value">{filteredUnits.length}</span>
              </div>
            )}
            {hasChanges && (
              <div className="stat-item">
                <span className="stat-label">Edited:</span>
                <span className="stat-value stat-edited">{editedUnits.size}</span>
              </div>
            )}
          </div>

          {/* Search/Replace Panel */}
          <div className="search-panel">
            <div className="search-row">
              {/* Source search field (only visible when searchIn === 'both') */}
              {searchIn === 'both' && (
                <div className="search-input-wrapper">
                  <input
                    type="text"
                    placeholder={useRegex ? "Source pattern (regex)" : "Search in source"}
                    value={liveSearch ? sourceSearchPattern : sourceSearchInput}
                    onChange={(e) => {
                      if (liveSearch) {
                        setSourceSearchPattern(e.target.value);
                      } else {
                        setSourceSearchInput(e.target.value);
                      }
                    }}
                    onKeyPress={!liveSearch ? handleSearchKeyPress : undefined}
                    className="search-input"
                  />
                  {useRegex && (liveSearch ? sourceSearchPattern : sourceSearchInput) && (
                    <span className="regex-validation-inline">
                      {validateRegex(liveSearch ? sourceSearchPattern : sourceSearchInput).valid ? (
                        <span className="validation-success" title="Valid regex">✓</span>
                      ) : (
                        <span className="validation-error">
                          ✗ <span className="error-icon" title={validateRegex(liveSearch ? sourceSearchPattern : sourceSearchInput).error}>ⓘ</span>
                        </span>
                      )}
                    </span>
                  )}
                </div>
              )}

              <div className="search-input-wrapper">
                <input
                  type="text"
                  placeholder={
                    searchIn === 'both'
                      ? (useRegex ? "Target pattern (regex)" : "Search in target")
                      : (useRegex ? "Search pattern (regex)" : "Search text")
                  }
                  value={liveSearch ? searchPattern : searchInput}
                  onChange={(e) => {
                    if (liveSearch) {
                      setSearchPattern(e.target.value);
                    } else {
                      setSearchInput(e.target.value);
                      if (e.target.value === '') {
                        setSearchPattern('');
                      }
                    }
                  }}
                  onKeyPress={!liveSearch ? handleSearchKeyPress : undefined}
                  className="search-input"
                />
                {useRegex && (liveSearch ? searchPattern : searchInput) && (
                  <span className="regex-validation-inline">
                    {validateRegex(liveSearch ? searchPattern : searchInput).valid ? (
                      <span className="validation-success" title="Valid regex">✓</span>
                    ) : (
                      <span className="validation-error">
                        ✗ <span className="error-icon" title={validateRegex(liveSearch ? searchPattern : searchInput).error}>ⓘ</span>
                      </span>
                    )}
                  </span>
                )}
                <button
                  onClick={() => setShowQuickApply(!showQuickApply)}
                  className="quick-apply-btn"
                  title="Quick Apply from Library"
                >
                  📋
                </button>
                {showQuickApply && (
                  <div className="quick-apply-dropdown">
                    <input
                      type="text"
                      placeholder="Search library..."
                      value={librarySearchTerm}
                      onChange={(e) => setLibrarySearchTerm(e.target.value)}
                      className="library-search-input"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="library-entries-list">
                      {filteredLibraryEntries.length === 0 ? (
                        <div className="no-entries">
                          {librarySearchTerm ? 'No matching entries' : 'No library entries yet'}
                        </div>
                      ) : (
                        filteredLibraryEntries.map(entry => (
                          <div
                            key={entry.id}
                            className="quick-apply-entry"
                            onClick={() => applyLibraryEntry(entry)}
                          >
                            <div className="quick-entry-name">{entry.name}</div>
                            {entry.description && (
                              <div className="quick-entry-description">{entry.description}</div>
                            )}
                            <div className="quick-entry-category">{entry.category}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              {!liveSearch && (
                <button onClick={handleSearch} className="search-btn">
                  Search
                </button>
              )}
              <button onClick={handleClearSearch} className="clear-btn" title="Clear search and replace fields">
                Clear
              </button>
              <input
                type="text"
                placeholder="Replace with"
                value={replacePattern}
                onChange={(e) => setReplacePattern(e.target.value)}
                className="search-input"
              />
              <button
                onClick={replaceInMatches}
                disabled={!searchPattern || !replacePattern || displayUnits.length === 0}
                className="replace-btn"
              >
                Replace in {displayUnits.length} match{displayUnits.length !== 1 ? 'es' : ''}
              </button>
            </div>
            <div className="search-options">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={useRegex}
                  onChange={(e) => setUseRegex(e.target.checked)}
                />
                Regex
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(e) => setCaseSensitive(e.target.checked)}
                />
                Case Sensitive
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={liveSearch}
                  onChange={(e) => setLiveSearch(e.target.checked)}
                />
                Live Search
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={protectTags}
                  onChange={(e) => setProtectTags(e.target.checked)}
                />
                Ignore Tags
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showOnlyEdited}
                  onChange={(e) => setShowOnlyEdited(e.target.checked)}
                />
                Show Only Edited
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showOnlyICUErrors}
                  onChange={(e) => setShowOnlyICUErrors(e.target.checked)}
                />
                Show Only ICU Errors
              </label>
              <label className="checkbox-label ignore-100-label">
                <input
                  type="checkbox"
                  checked={ignore100}
                  onChange={(e) => setIgnore100(e.target.checked)}
                />
                Ignore 100%
              </label>
              <label className="checkbox-label ignore-locked-label">
                <input
                  type="checkbox"
                  checked={ignoreLocked}
                  onChange={(e) => setIgnoreLocked(e.target.checked)}
                />
                Ignore Locked
              </label>

              <div className="jump-to-segment">
                <label className="jump-label">Jump:</label>
                <input
                  type="text"
                  placeholder="Segment #"
                  value={jumpToSegment}
                  onChange={(e) => setJumpToSegment(e.target.value)}
                  onKeyPress={handleJumpKeyPress}
                  className="jump-input"
                />
                <button onClick={handleJumpToSegment} className="jump-btn" disabled={!jumpToSegment}>
                  Go
                </button>
              </div>

              <div className="search-in-group">
                <span className="search-in-label">Search in:</span>
                <label className="radio-label">
                  <input
                    type="radio"
                    name="searchIn"
                    value="target"
                    checked={searchIn === 'target'}
                    onChange={() => setSearchIn('target')}
                  />
                  Target
                </label>
                <label className="radio-label">
                  <input
                    type="radio"
                    name="searchIn"
                    value="source"
                    checked={searchIn === 'source'}
                    onChange={() => setSearchIn('source')}
                  />
                  Source
                </label>
                <label className="radio-label">
                  <input
                    type="radio"
                    name="searchIn"
                    value="both"
                    checked={searchIn === 'both'}
                    onChange={() => setSearchIn('both')}
                  />
                  Both
                </label>
              </div>
            </div>
          </div>

          {/* Search Results Announcement */}
          {searchPattern && (
            <div role="status" aria-live="polite" style={{ padding: '8px 16px', fontSize: '14px', color: 'var(--text-secondary)' }}>
              Showing {displayUnits.length} of {xliffData?.trans_units.length || 0} segments{files.length > 1 ? ` across ${files.length} files` : ''}
            </div>
          )}

          <div
            className="table-container"
            id="table-container"
            style={{ '--id-col-width': `${Math.max(45, String(xliffData.trans_units.length).length * 12 + 24)}px` } as React.CSSProperties}
          >
            <table className="trans-units-table" role="table" aria-label="Translation segments">
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader">ID</th>
                  <th role="columnheader">Source</th>
                  <th role="columnheader">Target</th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {displayRows.map((row, rowIndex) => {
                  // File header row
                  if (isFileHeader(row)) {
                    return (
                      <tr key={`header-${row.fileIndex}`} className="file-header-row">
                        <td colSpan={3}>
                          <span className="file-header-name">{row.fileName}</span>
                          <span className="file-header-stats">
                            {row.stats.total_units} segments ({row.stats.translated} translated, {row.stats.untranslated} untranslated)
                          </span>
                        </td>
                      </tr>
                    );
                  }

                  // Normal segment row (TypeScript needs explicit cast after type guard)
                  const unit = row as DisplayUnit;
                  const currentValue = editedUnits.get(unit.id) || unit.target;
                  const isEdited = editedUnits.has(unit.id);
                  const rowGlobalId = unit.globalId || unit.id;
                  const isSelected = selectedSegmentId === rowGlobalId;

                  let icuErrors = unit.icu_errors || null;
                  if (isEdited && (hasICUSyntax(unit.source) || hasICUSyntax(currentValue))) {
                    const liveErrors = validateICU(unit.source, currentValue);
                    icuErrors = liveErrors.length > 0 ? liveErrors : null;
                  }
                  const hasICUError = icuErrors && icuErrors.length > 0;
                  const is100 = ignore100 && isUnit100(unit);
                  const isLocked = ignoreLocked && isUnitLocked(unit);

                  let displayId: string;
                  if (displayMode === 'perFile' && files.length > 1 && 'fileSegmentNumber' in unit) {
                    displayId = String((unit as DisplayUnit).fileSegmentNumber);
                  } else if (unit.segment_number != null) {
                    displayId = String(unit.segment_number);
                  } else if (unit.id.includes(':')) {
                    const numAfterColon = unit.id.split(':').pop();
                    displayId = numAfterColon && /^\d+$/.test(numAfterColon)
                      ? String(parseInt(numAfterColon, 10) + 1)
                      : unit.id;
                  } else {
                    displayId = unit.id;
                  }

                  const processed = processedTags.get(unit.id);
                  const processedTarget = processedEdited.get(unit.id) || processed?.target;

                  const sourceDisplay = searchPattern && (searchIn === 'source' || searchIn === 'both')
                    ? renderSegmentWithTagsAndHighlight(unit.source, processed?.source, showHiddenChars)
                    : renderSegmentWithTags(unit.source, processed?.source, showHiddenChars);

                  const targetDisplay = searchPattern && (searchIn === 'target' || searchIn === 'both')
                    ? renderSegmentWithTagsAndHighlight(currentValue, processedTarget, showHiddenChars)
                    : renderSegmentWithTags(currentValue, processedTarget, showHiddenChars);

                  return (
                    <tr
                      key={`${unit.id}-${rowIndex}`}
                      role="row"
                      className={[isEdited ? 'edited-row' : '', isSelected ? 'selected-row' : '', hasICUError ? 'icu-error-row' : '', is100 ? 'match-100-row' : '', isLocked ? 'locked-row' : ''].filter(Boolean).join(' ')}
                      title={`Full ID: ${unit.id}${hasICUError ? ' (ICU Error)' : ''}${is100 ? ' (100% match)' : ''}${isLocked ? ' (Locked)' : ''}`}
                      onClick={(e) => {
                        e.preventDefault();
                        const container = document.querySelector('.content');
                        if (container) setScrollPosition(container.scrollTop);
                        setSelectedSegmentId(rowGlobalId);
                        setSelectedUnit(unit);
                        setEditorValue(editedUnits.get(unit.id) || unit.target);
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <td role="cell">
                        {displayId}
                        {hasICUError && <span className="icu-error-badge" title="ICU syntax error">⚠️</span>}
                      </td>
                      <td role="cell" className={showHiddenChars ? 'show-hidden-chars' : ''}>
                        {sourceDisplay}
                      </td>
                      <td role="cell" className={showHiddenChars ? 'show-hidden-chars' : ''}>
                        {targetDisplay}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Editor Panel */}
          {selectedSegmentId && selectedUnit && (() => {

            // Use editorValue state instead of directly reading from editedUnits
            // This ensures the textarea updates when applyICUFix is called
            const currentValue = editorValue;
            const unitId = selectedUnit.id; // Original unit ID for editedUnits keying
            const unitIsReadOnly = isUnitReadOnly(selectedUnit);
            // Use segment_number for display if available, otherwise fall back to id
            let displayId: string;
            if (selectedUnit.segment_number != null) {
              displayId = String(selectedUnit.segment_number);
            } else if (selectedUnit.id.includes(':')) {
              // MXLIFF format: extract number after colon and add 1
              const numAfterColon = selectedUnit.id.split(':').pop();
              displayId = numAfterColon && /^\d+$/.test(numAfterColon)
                ? String(parseInt(numAfterColon, 10) + 1)
                : selectedUnit.id;
            } else {
              displayId = selectedUnit.id;
            }

            return (
              <div className={`editor-panel${unitIsReadOnly ? ' editor-readonly' : ''}`}>
                <div className="editor-header">
                  <h3>{unitIsReadOnly ? 'Viewing' : 'Editing'} Segment {displayId}
                    {isUnit100(selectedUnit) && <span className="editor-badge badge-100">100%</span>}
                    {isUnitLocked(selectedUnit) && <span className="editor-badge badge-locked">Locked</span>}
                  </h3>
                  <div className="editor-actions">
                    {selectedUnit.tms_metadata && (
                      <button
                        onClick={() => openInTMS(selectedUnit)}
                        className="editor-tms-btn"
                        title={`Open in ${selectedUnit.tms_metadata.tms_type || 'TMS'}`}
                      >
                        🔗 Open in {selectedUnit.tms_metadata.tms_type === 'lingotek' ? 'Lingotek' : selectedUnit.tms_metadata.tms_type === 'phrase' ? 'Phrase' : 'TMS'}
                      </button>
                    )}
                    {!unitIsReadOnly && (
                      <button
                        onClick={() => {
                          handleCellEdit(unitId, currentValue);
                          clearSelection();
                        }}
                        className="editor-save-btn"
                      >
                        Save (⌘+Enter)
                      </button>
                    )}
                    <button
                      onClick={() => clearSelection()}
                      className="editor-cancel-btn"
                    >
                      Close (Esc)
                    </button>
                  </div>
                </div>
                <div className="editor-content">
                  <div className="editor-column">
                    <label className="editor-label">Source (read-only)</label>
                    <div className={`editor-source ${showHiddenChars ? 'show-hidden-chars' : ''}`}>
                      {renderSegmentWithTags(selectedUnit.source, processedTags.get(selectedUnit.id)?.source, showHiddenChars)}
                    </div>
                  </div>
                  <div className="editor-column">
                    <label className="editor-label">Target {unitIsReadOnly ? '(read-only)' : '(editable)'}</label>
                    <textarea
                      value={showHiddenChars ? displayWithHiddenChars(currentValue) : currentValue}
                      onChange={(e) => { if (!unitIsReadOnly) handleCellEdit(unitId, e.target.value); }}
                      readOnly={unitIsReadOnly}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                          e.preventDefault();
                          clearSelection();
                        }
                      }}
                      className={`editor-target ${showHiddenChars ? 'show-hidden-chars' : ''}`}
                      autoFocus
                    />
                    {simplifyTags && (() => {
                      const targetProcessed = processSegmentTags(currentValue);
                      const hasTags = targetProcessed.displayParts.some(p => p.type === 'tag');
                      if (!hasTags) return null;
                      return (
                        <div className="editor-tag-preview">
                          <span className="editor-tag-preview-label">Preview:</span>
                          {renderSegmentWithTags(currentValue, targetProcessed, false)}
                        </div>
                      );
                    })()}
                  </div>
                </div>
                {selectedUnit.metadata && Object.keys(selectedUnit.metadata).length > 0 && (
                  <div className="editor-metadata">
                    <h4>Segment Information</h4>
                    <div className="metadata-grid">
                      {selectedUnit.metadata.match_percent && (
                        <div className="metadata-item">
                          <span className="metadata-label">Match:</span>
                          <span className="metadata-value">{selectedUnit.metadata.match_percent}%</span>
                        </div>
                      )}
                      {selectedUnit.metadata.match_quality && (
                        <div className="metadata-item">
                          <span className="metadata-label">Match Quality:</span>
                          <span className="metadata-value">{selectedUnit.metadata.match_quality}</span>
                        </div>
                      )}
                      {selectedUnit.metadata.state && (
                        <div className="metadata-item">
                          <span className="metadata-label">State:</span>
                          <span className="metadata-value">{selectedUnit.metadata.state}</span>
                        </div>
                      )}
                      {selectedUnit.metadata.locked && (
                        <div className="metadata-item">
                          <span className="metadata-label">Locked:</span>
                          <span className="metadata-value">{selectedUnit.metadata.locked === 'yes' ? 'Yes' : 'No'}</span>
                        </div>
                      )}
                      {selectedUnit.metadata.translate && (
                        <div className="metadata-item">
                          <span className="metadata-label">Translatable:</span>
                          <span className="metadata-value">{selectedUnit.metadata.translate === 'no' ? 'No' : 'Yes'}</span>
                        </div>
                      )}
                      {selectedUnit.metadata.approved && (
                        <div className="metadata-item">
                          <span className="metadata-label">Approved:</span>
                          <span className="metadata-value">{selectedUnit.metadata.approved === 'yes' ? 'Yes' : 'No'}</span>
                        </div>
                      )}
                      {selectedUnit.metadata.origin && (
                        <div className="metadata-item">
                          <span className="metadata-label">Origin:</span>
                          <span className="metadata-value">{selectedUnit.metadata.origin.toUpperCase()}</span>
                        </div>
                      )}
                      {selectedUnit.metadata.created_date && (
                        <div className="metadata-item">
                          <span className="metadata-label">Created:</span>
                          <span className="metadata-value">{selectedUnit.metadata.created_date}</span>
                        </div>
                      )}
                      {selectedUnit.metadata.created_by && (
                        <div className="metadata-item">
                          <span className="metadata-label">Created By:</span>
                          <span className="metadata-value">{selectedUnit.metadata.created_by}</span>
                        </div>
                      )}
                      {selectedUnit.metadata.modified_date && (
                        <div className="metadata-item">
                          <span className="metadata-label">Modified:</span>
                          <span className="metadata-value">{selectedUnit.metadata.modified_date}</span>
                        </div>
                      )}
                      {selectedUnit.metadata.modified_by && (
                        <div className="metadata-item">
                          <span className="metadata-label">Modified By:</span>
                          <span className="metadata-value">{selectedUnit.metadata.modified_by}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {(() => {
                  // Use live ICU validation for all segments with ICU syntax
                  // currentValue is now from editorValue state, which updates when Fix is clicked
                  let icuErrors = selectedUnit.icu_errors || null;

                  // Always use live validation if segment has ICU syntax (not just when edited)
                  // This ensures errors update after each Fix click
                  if (hasICUSyntax(selectedUnit.source) || hasICUSyntax(currentValue)) {
                    const liveErrors = validateICU(selectedUnit.source, currentValue);
                    icuErrors = liveErrors.length > 0 ? liveErrors : null;
                  }

                  if (icuErrors && icuErrors.length > 0) {
                    // Debug info array (commented out - uncomment if needed for debugging)
                    // const debugInfo: string[] = [];

                    return (
                      <div className="editor-icu-errors" key={currentValue}>
                        <h4>❌ ICU Syntax Errors ({icuErrors.length})</h4>
                        {/* Debug Info (commented out - uncomment if needed for debugging)
                        <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: '0.5rem', padding: '0.25rem', background: '#f9f9f9', border: '1px solid #ddd' }}>
                          <div><strong>Debug Info:</strong></div>
                          <div>Source: <code style={{ background: '#fff', padding: '2px 4px', fontSize: '0.7rem' }}>{selectedUnit.source.substring(0, 60)}{selectedUnit.source.length > 60 ? '...' : ''}</code></div>
                          <div>Target: <code style={{ background: '#fff', padding: '2px 4px', fontSize: '0.7rem' }}>{currentValue.substring(0, 60)}{currentValue.length > 60 ? '...' : ''}</code></div>
                          <div>Errors found: {icuErrors.length}</div>
                        </div>
                        */}
                        <div className="icu-errors-list">
                          {icuErrors.map((error, idx) => {
                            // Check if this error can be auto-fixed using current editor value
                            const fixResult = autoFixICUError(selectedUnit.source, currentValue, error);
                            const canAutoFix = fixResult !== null;

                            // debugInfo.push(`Error ${idx + 1}: "${error}" - Fix available: ${canAutoFix ? 'YES' : 'NO'}${canAutoFix ? ` (will change to: "${fixResult?.substring(0, 40)}...")` : ''}`);

                            return (
                              <div key={`${error}-${idx}`} style={{ marginBottom: '0.5rem' }}>
                                <div className="icu-error-item">
                                  <span className="icu-error-text">
                                    {idx + 1}. {error}
                                  </span>
                                  {canAutoFix ? (
                                    <button
                                      className="icu-fix-btn"
                                      onClick={() => applyICUFix(unitId, error)}
                                      title="Automatically fix this error"
                                    >
                                      🔧 Fix
                                    </button>
                                  ) : (
                                    <span style={{ fontSize: '0.7rem', color: '#999', marginLeft: '0.5rem' }}>(no fix available)</span>
                                  )}
                                </div>
                                {canAutoFix && (
                                  <div style={{ fontSize: '0.65rem', color: '#666', marginTop: '0.25rem', marginLeft: '1.5rem' }}>
                                    Will apply: <code style={{ background: '#f0f0f0', padding: '1px 3px' }}>{fixResult?.substring(0, 80)}{(fixResult?.length ?? 0) > 80 ? '...' : ''}</code>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {/* Debug Details and Activity Log (commented out - uncomment if needed for debugging)
                        <div style={{ fontSize: '0.65rem', color: '#666', marginTop: '0.5rem', padding: '0.5rem', background: '#f9f9f9', border: '1px solid #ddd' }}>
                          <details>
                            <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>Debug Details (click to expand)</summary>
                            <div style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                              {debugInfo.join('\n')}
                            </div>
                          </details>
                        </div>
                        {debugLogs.length > 0 && (
                          <div style={{ fontSize: '0.65rem', marginTop: '0.5rem', padding: '0.5rem', background: '#fffbea', border: '1px solid #f59e0b' }}>
                            <div style={{ fontWeight: 'bold', marginBottom: '0.25rem', color: '#92400e' }}>🔍 Fix Activity Log (last 10 actions):</div>
                            <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.6rem', color: '#78350f' }}>
                              {debugLogs.join('\n')}
                            </div>
                            <button
                              onClick={() => setDebugLogs([])}
                              style={{ marginTop: '0.5rem', fontSize: '0.6rem', padding: '0.2rem 0.5rem', cursor: 'pointer' }}
                            >
                              Clear Log
                            </button>
                          </div>
                        )}
                        */}
                      </div>
                    );
                  }
                  return null;
                })()}
              </div>
            );
          })()}
        </div>
      )}

      {!xliffData && !error && (
        <div className="welcome">
          <p>Open an XLIFF or TMX file to get started</p>
          <p className="supported-formats">
            Supported formats: .xliff, .xlf, .mxliff (Phrase), .mqxliff (MemoQ), .sdlxliff (Trados), .tmx
          </p>
        </div>
      )}
    </div>
  );
}

export { App };
export default App;
