import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileData, Settings, Violation } from "./SpellcheckPanel";
import TriageWindow, { FlaggedWord } from "./TriageWindow";
import ResultsWindow from "./ResultsWindow";

export type SpellcheckState =
  | "idle"
  | "running"
  | "triage"
  | "running_term"
  | "combined_results"
  | "results";

interface Props {
  fileData: FileData | null;
  filePath: string;
  settings: Settings;
  spellState: SpellcheckState;
  setSpellState: (s: SpellcheckState) => void;
  flaggedWords: FlaggedWord[];
  setFlaggedWords: (w: FlaggedWord[]) => void;
  realErrors: FlaggedWord[];
  setRealErrors: (w: FlaggedWord[]) => void;
  combinedMode: boolean;
  setCombinedMode: (v: boolean) => void;
  violations: Violation[];
  setViolations: (v: Violation[]) => void;
  runAllTrigger?: number;
}

export default function SpellcheckTab({
  fileData, filePath, settings,
  spellState, setSpellState,
  flaggedWords, setFlaggedWords,
  realErrors, setRealErrors,
  combinedMode, setCombinedMode,
  violations, setViolations,
  runAllTrigger,
}: Props) {
  const [error, setError] = useState<string>("");
  const prevTrigger = useRef(0);

  useEffect(() => {
    if (runAllTrigger && runAllTrigger !== prevTrigger.current) {
      prevTrigger.current = runAllTrigger;
      runAllChecks();
    }
  }, [runAllTrigger]);

  // Termlist/checklist files for exclusion (only enabled ones)
  const enabledTermlists = settings.termlists.filter((t) => t.enabled).map((t) => t.path);
  const enabledChecklists = settings.checklists.filter((c) => c.enabled).map((c) => c.path);
  const exclusionFiles = [...enabledTermlists, ...enabledChecklists];

  async function runSpellcheck() {
    if (!filePath || !fileData) {
      setError("No file loaded. Please open an XLIFF file first.");
      return;
    }
    if (settings.selected_dics.length === 0) {
      setError("No dictionaries selected. Please configure dictionaries in Settings.");
      return;
    }

    setError("");
    setCombinedMode(false);
    setSpellState("running");
    try {
      const result = await invoke<{ flagged_words: FlaggedWord[] }>("sc_run_spellcheck", {
        filePath,
        dics: settings.selected_dics,
        exclusionFiles: exclusionFiles,
        skipLocked: settings.skip_locked ?? true,
        compoundCheck: settings.compound_check ?? true,
      });
      setFlaggedWords(result.flagged_words);
      setSpellState("triage");
    } catch (e) {
      setError(String(e));
      setSpellState("idle");
    }
  }

  async function runAllChecks() {
    if (!filePath || !fileData) {
      setError("No file loaded. Please open an XLIFF file first.");
      return;
    }
    if (settings.selected_dics.length === 0) {
      setError("No dictionaries selected. Please configure dictionaries in Settings.");
      return;
    }

    setError("");
    setCombinedMode(true);
    setViolations([]);
    setSpellState("running");
    try {
      const result = await invoke<{ flagged_words: FlaggedWord[] }>("sc_run_spellcheck", {
        filePath,
        dics: settings.selected_dics,
        exclusionFiles: exclusionFiles,
        skipLocked: settings.skip_locked ?? true,
        compoundCheck: settings.compound_check ?? true,
      });
      setFlaggedWords(result.flagged_words);
      setSpellState("triage");
    } catch (e) {
      setError(String(e));
      setCombinedMode(false);
      setSpellState("idle");
    }
  }

  async function runTermCheckAfterTriage(words: FlaggedWord[]) {
    setRealErrors(words);
    setSpellState("running_term");

    const enabledTermlistPaths = settings.termlists.filter((t) => t.enabled).map((t) => t.path);
    const enabledChecklistPaths = settings.checklists.filter((c) => c.enabled).map((c) => c.path);
    const hasTermFiles = enabledTermlistPaths.length > 0 || enabledChecklistPaths.length > 0;

    try {
      // Build QA checks string from settings
      const qaChecks = settings.qa_checks ?? {};
      const enabledQaIds = Object.entries(qaChecks)
        .filter(([, on]) => on)
        .map(([id]) => id)
        .join(",") || "none";

      // Run term check, number check, and QA checks in parallel
      const [termResult, numberResult, qaResult] = await Promise.all([
        hasTermFiles
          ? invoke<{ violations: Violation[] }>("sc_run_term_check", {
              filePath,
              termlists: enabledTermlistPaths,
              checklists: enabledChecklistPaths,
            })
          : Promise.resolve({ violations: [] as Violation[] }),
        invoke<{ violations: Violation[] }>("sc_run_number_check", {
          filePath,
          skipLocked: settings.skip_locked ?? true,
        }),
        invoke<{ violations: Violation[] }>("sc_run_qa_checks", {
          filePath,
          skipLocked: settings.skip_locked ?? true,
          checks: enabledQaIds,
        }),
      ]);

      setViolations([...termResult.violations, ...numberResult.violations, ...qaResult.violations]);
      setSpellState("combined_results");
    } catch (e) {
      setError(String(e));
      // Fallback: show spellcheck-only results if checks fail
      setSpellState(words.length === 0 ? "idle" : "results");
    }
  }

  function handleTriageDone(words: FlaggedWord[]) {
    if (combinedMode) {
      runTermCheckAfterTriage(words);
    } else {
      setRealErrors(words);
      setSpellState(words.length === 0 ? "idle" : "results");
    }
  }

  if (spellState === "triage") {
    return (
      <div className="spellcheck-main">
        <TriageWindow
          flaggedWords={flaggedWords}
          filePath={filePath}
          settings={settings}
          onDone={handleTriageDone}
        />
      </div>
    );
  }

  if (spellState === "running_term") {
    return (
      <div className="spellcheck-main">
        <div className="empty-state" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <h2 style={{ fontSize: 15, marginTop: 12, marginBottom: 6, color: "var(--text-secondary)" }}>
            Running additional checks…
          </h2>
          <p>Spellcheck triage complete. Running terminology, number, and formatting checks.</p>
        </div>
      </div>
    );
  }

  if (spellState === "combined_results") {
    return (
      <div className="spellcheck-main">
        <ResultsWindow
          realErrors={realErrors}
          filePath={filePath}
          settings={settings}
          onBack={() => setSpellState("triage")}
          violations={violations}
        />
      </div>
    );
  }

  if (spellState === "results") {
    return (
      <div className="spellcheck-main">
        <ResultsWindow
          realErrors={realErrors}
          filePath={filePath}
          settings={settings}
          onBack={() => setSpellState("triage")}
        />
      </div>
    );
  }

  // idle / running
  return (
    <div className="spellcheck-layout">
      {/* Config bar */}
      <div className="spellcheck-config" role="region" aria-label="Spellcheck configuration">
        {/* Dictionaries summary */}
        <div className="config-section">
          <h2
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "var(--text-secondary)",
              marginBottom: 6,
            }}
          >
            Dictionaries
          </h2>
          {settings.selected_dics.length === 0 ? (
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              None selected — go to Settings
            </span>
          ) : (
            <ul
              aria-label="Selected dictionaries"
              style={{ listStyle: "none", padding: 0, margin: 0 }}
            >
              {settings.selected_dics.map((d) => (
                <li key={d} style={{ fontSize: 12, padding: "2px 0" }}>
                  ✓ {d.split("/").pop()}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Exclusion files summary */}
        {exclusionFiles.length > 0 && (
          <div className="config-section">
            <h2
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "var(--text-secondary)",
                marginBottom: 6,
              }}
            >
              Exclusion files
            </h2>
            <ul
              aria-label="Active exclusion files"
              style={{ listStyle: "none", padding: 0, margin: 0 }}
            >
              {exclusionFiles.map((f) => (
                <li
                  key={f}
                  style={{ fontSize: 12, padding: "2px 0", color: "var(--text-secondary)" }}
                >
                  {f.split("/").pop()}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Run buttons */}
        <div style={{ marginLeft: "auto", alignSelf: "flex-end", display: "flex", gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={runSpellcheck}
            disabled={spellState === "running" || !fileData}
            aria-busy={spellState === "running" && !combinedMode}
            aria-label={
              spellState === "running" && !combinedMode
                ? "Running spellcheck, please wait…"
                : !fileData
                ? "Run spellcheck (no file loaded)"
                : "Run spellcheck only"
            }
          >
            {spellState === "running" && !combinedMode ? (
              <>
                <span className="spinner" aria-hidden="true" style={{ marginRight: 6 }} />
                Running…
              </>
            ) : (
              "Run spellcheck"
            )}
          </button>
          <button
            className="btn btn-primary"
            onClick={runAllChecks}
            disabled={spellState === "running" || !fileData}
            aria-busy={spellState === "running" && combinedMode}
            aria-label={
              spellState === "running" && combinedMode
                ? "Running all checks, please wait…"
                : !fileData
                ? "Run all checks (no file loaded)"
                : "Run spellcheck and terminology check together"
            }
          >
            {spellState === "running" && combinedMode ? (
              <>
                <span className="spinner" aria-hidden="true" style={{ marginRight: 6 }} />
                Running…
              </>
            ) : (
              "Run all checks"
            )}
          </button>
        </div>
      </div>

      {/* Content area */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {/* Error — use role="alert" for immediate announcement */}
        {error && (
          <div style={{ maxWidth: 480 }}>
            <div className="error-banner" role="alert">
              {error}
            </div>
          </div>
        )}

        {!error && !fileData && (
          <div className="empty-state">
            <h2 style={{ fontSize: 15, marginBottom: 6, color: "var(--text-secondary)" }}>
              No file loaded
            </h2>
            <p>Open an XLIFF file using the button above to get started.</p>
          </div>
        )}

        {!error && fileData && spellState === "idle" && (
          <div className="empty-state">
            <h2 style={{ fontSize: 15, marginBottom: 6, color: "var(--text-secondary)" }}>
              Ready to run
            </h2>
            <p>
              {fileData.stats.total_segments} segment
              {fileData.stats.total_segments !== 1 ? "s" : ""} loaded
              {fileData.stats.untranslated > 0
                ? ` (${fileData.stats.untranslated} untranslated will be skipped)`
                : ""}
            </p>
            <p style={{ marginTop: 8 }}>
              Click "Run all checks" for spellcheck + terminology + number/formatting checks, or "Run spellcheck" for spelling only.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
