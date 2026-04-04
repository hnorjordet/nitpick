/**
 * SpellcheckPanel — adapted from SpellcheckQA's App.tsx.
 * Receives filePath from the parent AppShell instead of having its own file dialog.
 * All invoke calls use sc_* prefixed commands.
 */
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import SpellcheckTab, { SpellcheckState } from "./SpellcheckTab";
import TerminologyTab from "./TerminologyTab";
import QATab from "./QATab";
import SettingsPage from "./SettingsPage";
import { FlaggedWord } from "./TriageWindow";

export type ResultsDisplayMode = 1 | 2 | 3;

export interface Segment {
  id: string;
  source: string;
  target: string;
  file_name: string;
}

export interface Violation {
  segment_id: string;
  file_name: string;
  violation_type: string;
  source_term: string;
  target_term: string | null;
  description: string;
  source_text: string;
  target_text: string;
  check_source: "termlist" | "checklist" | "number" | "qa";
}

export interface FileData {
  segments: Segment[];
  target_language: string;
  stats: { total_segments: number; translated: number; untranslated: number };
}

export interface FileEntry {
  path: string;
  enabled: boolean;
}

export interface Settings {
  dic_folder: string;
  selected_dics: string[];
  termlists: FileEntry[];
  checklists: FileEntry[];
  backup_enabled: boolean;
  strict_lang_match: boolean;
  results_display_mode: ResultsDisplayMode;
  skip_locked: boolean;
  compound_check: boolean;
  watch_folder_enabled: boolean;
  watch_folder: string;
  qa_checks: Record<string, boolean>;
}

export const DEFAULT_QA_CHECKS: Record<string, boolean> = {
  untranslated: true,
  source_equals_target: true,
  inconsistent_source: true,
  inconsistent_target: true,
  tag_mismatch: true,
  url_email_mismatch: true,
  alphanumeric_mismatch: true,
  double_blanks: true,
  repeated_words: true,
  uppercase_mismatch: true,
  camelcase_mismatch: true,
};

export type TabId = "spellcheck" | "terminology" | "qa" | "settings";

const TAB_LABELS: Record<TabId, string> = {
  spellcheck: "Spellcheck",
  terminology: "Terminology",
  qa: "QA Checks",
  settings: "Settings",
};

const TAB_IDS = ["spellcheck", "terminology", "qa", "settings"] as TabId[];

interface SpellcheckPanelProps {
  filePath: string;
  onFileLoaded?: (path: string) => void;
}

export default function SpellcheckPanel({ filePath: externalFilePath, onFileLoaded }: SpellcheckPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>("spellcheck");
  const [filePath, setFilePath] = useState<string>("");
  const [fileData, setFileData] = useState<FileData | null>(null);
  const [loadError, setLoadError] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const [spellState, setSpellState] = useState<SpellcheckState>("idle");
  const [flaggedWords, setFlaggedWords] = useState<FlaggedWord[]>([]);
  const [realErrors, setRealErrors] = useState<FlaggedWord[]>([]);

  const [combinedMode, setCombinedMode] = useState(false);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [runAllTrigger, setRunAllTrigger] = useState(0);

  function handleRunAllFromExternalTab() {
    setActiveTab("spellcheck");
    setRunAllTrigger(n => n + 1);
  }

  const [settings, setSettings] = useState<Settings>({
    dic_folder: "",
    selected_dics: [],
    termlists: [],
    checklists: [],
    backup_enabled: true,
    strict_lang_match: false,
    results_display_mode: 1,
    skip_locked: true,
    compound_check: true,
    watch_folder_enabled: false,
    watch_folder: "",
    qa_checks: { ...DEFAULT_QA_CHECKS },
  });

  const settingsRef = useRef(settings);

  // Watch folder queue and banner state
  const [watchQueue, setWatchQueue] = useState<string[]>([]);
  const [watchBanner, setWatchBanner] = useState<{ files: string[] } | null>(null);
  const [merging, setMerging] = useState(false);
  const watchQueueRef = useRef<string[]>([]);

  // Load settings on startup
  useEffect(() => {
    invoke<Settings>("sc_load_settings")
      .then((s) => {
        const loaded: Settings = {
          ...s,
          results_display_mode: s.results_display_mode ?? 1,
          skip_locked: s.skip_locked ?? true,
          compound_check: s.compound_check ?? true,
          watch_folder_enabled: s.watch_folder_enabled ?? false,
          watch_folder: s.watch_folder ?? "",
          qa_checks: { ...DEFAULT_QA_CHECKS, ...(s.qa_checks ?? {}) },
        };
        setSettings(loaded);
        settingsRef.current = loaded;
        if (loaded.watch_folder_enabled && loaded.watch_folder) {
          startWatcher(loaded.watch_folder);
        }
      })
      .catch((e) => console.error("Failed to load settings:", e));
  }, []);

  // When external file path changes (file opened in RegEx panel), load it
  useEffect(() => {
    if (externalFilePath && externalFilePath !== filePath) {
      loadFile(externalFilePath);
    }
  }, [externalFilePath]);

  async function startWatcher(folder: string) {
    invoke("sc_start_folder_watch", { folder }).catch(console.error);
    try {
      const result = await invoke<{ files: string[] }>("sc_scan_watch_folder", { folder });
      if (result.files.length === 1) {
        loadFile(result.files[0]);
      } else if (result.files.length > 1) {
        setWatchBanner({ files: result.files });
      }
    } catch (e) {
      console.error("Failed to scan watch folder:", e);
    }
  }

  useEffect(() => {
    const unlisten = listen<string>("xliff-file-detected", (event) => {
      const newFile = event.payload;
      if (filePath) {
        setWatchQueue((q) => {
          const updated = [...q, newFile];
          watchQueueRef.current = updated;
          return updated;
        });
      } else {
        loadFile(newFile);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [filePath]);

  async function mergeAndLoad(files: string[]) {
    setMerging(true);
    setWatchBanner(null);
    try {
      const result = await invoke<{
        ok: boolean; output_path: string; files_merged: number;
        total_segments: number; warnings: string[]; error: string | null;
      }>("sc_merge_files", { files, output: "" });
      if (result.ok) {
        await loadFile(result.output_path);
      } else {
        setLoadError(result.error ?? "Merge failed");
      }
    } catch (e) {
      setLoadError(String(e));
    } finally {
      setMerging(false);
    }
  }

  function loadNextFromQueue() {
    const [next, ...rest] = watchQueueRef.current;
    watchQueueRef.current = rest;
    setWatchQueue(rest);
    if (next) loadFile(next);
  }

  async function loadFile(path: string) {
    setFilePath(path);
    setLoadError("");
    setLoading(true);
    setFileData(null);
    setSpellState("idle");
    setFlaggedWords([]);
    setRealErrors([]);
    setCombinedMode(false);
    setViolations([]);
    try {
      const data = await invoke<FileData>("sc_load_file", { filePath: path });
      setFileData(data);
      onFileLoaded?.(path);
    } catch (e: unknown) {
      setLoadError(String(e));
    } finally {
      setLoading(false);
    }
  }

  function handleSettingsChange(newSettings: Settings) {
    setSettings(newSettings);
    settingsRef.current = newSettings;
    invoke("sc_save_settings", { data: JSON.stringify(newSettings) }).catch((e) =>
      console.error("Failed to save settings:", e)
    );

    const prev = settingsRef.current;
    const watchChanged =
      prev.watch_folder_enabled !== newSettings.watch_folder_enabled ||
      prev.watch_folder !== newSettings.watch_folder;

    if (watchChanged) {
      if (newSettings.watch_folder_enabled && newSettings.watch_folder) {
        startWatcher(newSettings.watch_folder);
      } else {
        invoke("sc_stop_folder_watch").catch(console.error);
        setWatchBanner(null);
        setWatchQueue([]);
        watchQueueRef.current = [];
      }
    }
  }

  function handleTabKeyDown(e: React.KeyboardEvent, currentTab: TabId) {
    const idx = TAB_IDS.indexOf(currentTab);
    if (e.key === "ArrowRight") {
      e.preventDefault();
      const next = TAB_IDS[(idx + 1) % TAB_IDS.length];
      setActiveTab(next);
      (document.querySelector(`[data-sc-tab="${next}"]`) as HTMLElement)?.focus();
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prev = TAB_IDS[(idx - 1 + TAB_IDS.length) % TAB_IDS.length];
      setActiveTab(prev);
      (document.querySelector(`[data-sc-tab="${prev}"]`) as HTMLElement)?.focus();
    }
    if (e.key === "Home") {
      e.preventDefault();
      setActiveTab(TAB_IDS[0]);
      (document.querySelector(`[data-sc-tab="${TAB_IDS[0]}"]`) as HTMLElement)?.focus();
    }
    if (e.key === "End") {
      e.preventDefault();
      const last = TAB_IDS[TAB_IDS.length - 1];
      setActiveTab(last);
      (document.querySelector(`[data-sc-tab="${last}"]`) as HTMLElement)?.focus();
    }
  }

  return (
    <div className="spellcheck-panel">
      {/* Tab navigation */}
      <header className="sc-topbar">
        <nav aria-label="Spellcheck navigation">
          <div className="tab-nav" role="tablist" aria-label="Spellcheck tabs">
            {TAB_IDS.map((tab) => (
              <button
                key={tab}
                data-sc-tab={tab}
                id={`sc-tab-${tab}`}
                role="tab"
                aria-selected={activeTab === tab}
                aria-controls={`sc-tabpanel-${tab}`}
                className={`tab-btn${activeTab === tab ? " active" : ""}`}
                tabIndex={activeTab === tab ? 0 : -1}
                onClick={() => setActiveTab(tab)}
                onKeyDown={(e) => handleTabKeyDown(e, tab)}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>
        </nav>
      </header>

      {/* File info bar */}
      {activeTab !== "settings" && (
        <div className="file-bar" role="region" aria-label="File info">
          <span className="file-path" aria-live="polite">
            {filePath ? filePath.split("/").pop() : "No file loaded"}
          </span>
          {fileData && (
            <span className="lang-badge" aria-label={`Target language: ${fileData.target_language || "unknown"}`}>
              {fileData.target_language || "?"}
            </span>
          )}
          {fileData && (
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              {fileData.stats.total_segments} segments
            </span>
          )}
          {loading && (
            <>
              <span className="spinner" aria-hidden="true" />
              <span className="sr-only" aria-live="polite">Loading file...</span>
            </>
          )}
        </div>
      )}

      {/* Watch folder banner */}
      {watchBanner && (
        <div role="region" aria-label="Watch folder files found" style={{
          background: "var(--accent-subtle, #1e3a5f)", borderBottom: "1px solid var(--border)",
          padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
        }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>
            {watchBanner.files.length} XLIFF files in watch folder
          </span>
          <button className="btn btn-secondary btn-sm" onClick={() => {
            loadFile(watchBanner.files[0]);
            const rest = watchBanner.files.slice(1);
            watchQueueRef.current = rest;
            setWatchQueue(rest);
            setWatchBanner(null);
          }}>Load first</button>
          <button className="btn btn-primary btn-sm" onClick={() => mergeAndLoad(watchBanner.files)} disabled={merging}>
            {merging ? "Merging..." : `Merge all ${watchBanner.files.length} & load`}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setWatchBanner(null)}
            aria-label="Dismiss" style={{ marginLeft: "auto", color: "var(--text-secondary)" }}>X</button>
        </div>
      )}

      {/* Queue indicator */}
      {watchQueue.length > 0 && !watchBanner && (
        <div style={{
          background: "var(--surface-2, #1a1a2e)", borderBottom: "1px solid var(--border)",
          padding: "6px 16px", display: "flex", alignItems: "center", gap: 12,
        }}>
          <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
            Queue: {watchQueue.length} file{watchQueue.length !== 1 ? "s" : ""} waiting
          </span>
          <button className="btn btn-secondary btn-sm" onClick={loadNextFromQueue}>Load next</button>
          <button className="btn btn-ghost btn-sm" style={{ color: "var(--text-secondary)" }}
            onClick={() => { setWatchQueue([]); watchQueueRef.current = []; }}>Clear queue</button>
        </div>
      )}

      {/* Tab content */}
      <div className="tab-content">
        {loadError && activeTab !== "settings" && (
          <div style={{ padding: "12px 16px" }}>
            <div className="error-banner" role="alert">{loadError}</div>
          </div>
        )}

        <div id="sc-tabpanel-spellcheck" role="tabpanel" aria-labelledby="sc-tab-spellcheck"
          hidden={activeTab !== "spellcheck"}
          style={{ display: activeTab === "spellcheck" ? "flex" : "none", flexDirection: "column", flex: 1, overflow: "hidden" }}
          tabIndex={-1}>
          <SpellcheckTab fileData={fileData} filePath={filePath} settings={settings}
            spellState={spellState} setSpellState={setSpellState}
            flaggedWords={flaggedWords} setFlaggedWords={setFlaggedWords}
            realErrors={realErrors} setRealErrors={setRealErrors}
            combinedMode={combinedMode} setCombinedMode={setCombinedMode}
            violations={violations} setViolations={setViolations}
            runAllTrigger={runAllTrigger} />
        </div>

        <div id="sc-tabpanel-terminology" role="tabpanel" aria-labelledby="sc-tab-terminology"
          hidden={activeTab !== "terminology"}
          style={{ display: activeTab === "terminology" ? "flex" : "none", flexDirection: "column", flex: 1, overflow: "hidden" }}
          tabIndex={-1}>
          <TerminologyTab fileData={fileData} filePath={filePath} settings={settings}
            onRunAll={handleRunAllFromExternalTab}
            runningAll={spellState === "running" || spellState === "running_term"} />
        </div>

        <div id="sc-tabpanel-qa" role="tabpanel" aria-labelledby="sc-tab-qa"
          hidden={activeTab !== "qa"}
          style={{ display: activeTab === "qa" ? "flex" : "none", flexDirection: "column", flex: 1, overflow: "hidden" }}
          tabIndex={-1}>
          <QATab fileData={fileData} filePath={filePath} settings={settings}
            onRunAll={handleRunAllFromExternalTab}
            runningAll={spellState === "running" || spellState === "running_term"} />
        </div>

        <div id="sc-tabpanel-settings" role="tabpanel" aria-labelledby="sc-tab-settings"
          hidden={activeTab !== "settings"}
          style={{ display: activeTab === "settings" ? "flex" : "none", flexDirection: "column", flex: 1, overflowY: "auto" }}
          tabIndex={-1}>
          <SettingsPage settings={settings} onSettingsChange={handleSettingsChange} />
        </div>
      </div>
    </div>
  );
}
