import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileData, Settings, Violation } from "./SpellcheckPanel";
import { FlaggedWord } from "./TriageWindow";
import TriageWindow from "./TriageWindow";
import ResultsWindow from "./ResultsWindow";

interface Props {
  fileData: FileData | null;
  filePath: string;
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
}

type RunState = "idle" | "running_spell" | "triage" | "running_checks" | "results";

export default function ChecksTab({ fileData, filePath, settings, onSettingsChange }: Props) {
  const [runSpell, setRunSpell] = useState(true);
  const [runTerm, setRunTerm] = useState(true);
  const [runChecklist, setRunChecklist] = useState(true);
  const [runQA, setRunQA] = useState(true);

  const [state, setState] = useState<RunState>("idle");
  const [error, setError] = useState("");
  const [flaggedWords, setFlaggedWords] = useState<FlaggedWord[]>([]);
  const [realErrors, setRealErrors] = useState<FlaggedWord[]>([]);
  const [violations, setViolations] = useState<Violation[]>([]);

  const enabledTermlists = settings.termlists.filter((t) => t.enabled).map((t) => t.path);
  const enabledChecklists = settings.checklists.filter((c) => c.enabled).map((c) => c.path);
  const anyCheckSelected = runSpell || runTerm || runChecklist || runQA;
  const isRunning = state === "running_spell" || state === "running_checks";

  async function handleRun() {
    if (!filePath || !fileData) { setError("No file loaded. Open an XLIFF file first."); return; }
    if (runSpell && settings.selected_dics.length === 0) { setError("No dictionaries selected. Configure dictionaries in Settings."); return; }

    setError("");
    setViolations([]);
    setFlaggedWords([]);
    setRealErrors([]);

    if (runSpell) {
      setState("running_spell");
      try {
        const result = await invoke<{ flagged_words: FlaggedWord[] }>("sc_run_spellcheck", {
          filePath,
          dics: settings.selected_dics,
          exclusionFiles: [...enabledTermlists, ...enabledChecklists],
          skipLocked: settings.skip_locked ?? true,
          skip100Match: settings.skip_100_match ?? true,
          compoundCheck: settings.compound_check ?? true,
        });
        setFlaggedWords(result.flagged_words);
        setState("triage");
      } catch (e) {
        setError(String(e));
        setState("idle");
      }
    } else {
      await runOtherChecks([]);
    }
  }

  async function runOtherChecks(confirmedErrors: FlaggedWord[]) {
    setRealErrors(confirmedErrors);

    if (!runTerm && !runChecklist && !runQA) {
      setState("results");
      return;
    }

    setState("running_checks");
    try {
      const enabledQaIds = Object.entries(settings.qa_checks ?? {})
        .filter(([, on]) => on).map(([id]) => id).join(",") || "none";

      const termlistPaths = runTerm ? enabledTermlists : [];
      const checklistPaths = runChecklist ? enabledChecklists : [];
      const hasTermFiles = termlistPaths.length > 0 || checklistPaths.length > 0;

      const [termResult, numberResult, qaResult] = await Promise.all([
        hasTermFiles
          ? invoke<{ violations: Violation[] }>("sc_run_term_check", {
              filePath, termlists: termlistPaths, checklists: checklistPaths,
              skipLocked: settings.skip_locked ?? true, skip100Match: settings.skip_100_match ?? true,
            })
          : Promise.resolve({ violations: [] as Violation[] }),
        invoke<{ violations: Violation[] }>("sc_run_number_check", {
          filePath, skipLocked: settings.skip_locked ?? true, skip100Match: settings.skip_100_match ?? true,
        }),
        runQA
          ? invoke<{ violations: Violation[] }>("sc_run_qa_checks", {
              filePath, skipLocked: settings.skip_locked ?? true, skip100Match: settings.skip_100_match ?? true,
              checks: enabledQaIds,
            })
          : Promise.resolve({ violations: [] as Violation[] }),
      ]);

      setViolations([...termResult.violations, ...numberResult.violations, ...qaResult.violations]);
      setState("results");
    } catch (e) {
      setError(String(e));
      setState(confirmedErrors.length > 0 ? "results" : "idle");
    }
  }

  function handleReset() {
    setState("idle");
    setError("");
    setFlaggedWords([]);
    setRealErrors([]);
    setViolations([]);
  }

  // Right panel content
  function renderRight() {
    if (state === "triage") {
      return (
        <TriageWindow
          flaggedWords={flaggedWords}
          filePath={filePath}
          settings={settings}
          onDone={(confirmed) => runOtherChecks(confirmed)}
        />
      );
    }

    if (state === "running_checks") {
      return (
        <div className="empty-state" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <h2 style={{ fontSize: 15, marginTop: 12, marginBottom: 6, color: "var(--text-secondary)" }}>
            Running checks…
          </h2>
          <p>Running terminology, number, and formatting checks.</p>
        </div>
      );
    }

    if (state === "results") {
      return (
        <ResultsWindow
          realErrors={realErrors}
          filePath={filePath}
          settings={settings}
          onBack={() => setState("triage")}
          violations={violations}
          onNewRun={handleReset}
        />
      );
    }

    // idle / running_spell
    return (
      <div className="empty-state" role="status" aria-live="polite">
        {state === "running_spell" ? (
          <>
            <span className="spinner" aria-hidden="true" />
            <h2 style={{ fontSize: 15, marginTop: 12, marginBottom: 6, color: "var(--text-secondary)" }}>
              Running spellcheck…
            </h2>
          </>
        ) : (
          <>
            <h2 style={{ fontSize: 15, marginBottom: 6, color: "var(--text-secondary)" }}>
              Ready
            </h2>
            <p>
              {!fileData
                ? "Open an XLIFF file, then click Run."
                : `${fileData.stats.total_segments} segments loaded. Select checks and click Run.`}
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>

      {/* ── Left sidebar: controls ─────────────────────────────────────────── */}
      <div style={{
        width: 220, flexShrink: 0, borderRight: "1px solid var(--border)",
        overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 16,
      }}>

        {/* Checks */}
        <section>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-secondary)", marginBottom: 8 }}>
            Checks
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label className="checkbox-row" style={{ fontSize: 13 }}>
              <input type="checkbox" checked={runSpell} onChange={e => setRunSpell(e.target.checked)} />
              <span>Spellcheck</span>
            </label>
            <label className="checkbox-row" style={{ fontSize: 13 }}>
              <input type="checkbox" checked={runTerm} onChange={e => setRunTerm(e.target.checked)} />
              <span>Terminology</span>
            </label>
            <label className="checkbox-row" style={{ fontSize: 13 }}>
              <input type="checkbox" checked={runChecklist} onChange={e => setRunChecklist(e.target.checked)} />
              <span>Checklists</span>
            </label>
            <label className="checkbox-row" style={{ fontSize: 13 }}>
              <input type="checkbox" checked={runQA} onChange={e => setRunQA(e.target.checked)} />
              <span>QA checks</span>
            </label>
          </div>
        </section>

        {/* Segment filter */}
        <section>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-secondary)", marginBottom: 8 }}>
            Segment filter
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label className="checkbox-row" style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                checked={settings.skip_locked ?? true}
                onChange={e => onSettingsChange({ ...settings, skip_locked: e.target.checked })}
              />
              <span>Skip locked</span>
            </label>
            <label className="checkbox-row" style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                checked={settings.skip_100_match ?? true}
                onChange={e => onSettingsChange({ ...settings, skip_100_match: e.target.checked })}
              />
              <span>Skip 100% matches</span>
            </label>
          </div>
        </section>

        {/* File info */}
        {fileData && (
          <div style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            {filePath.split("/").pop()}<br />
            {fileData.stats.total_segments} segments
            {fileData.stats.untranslated > 0 && `, ${fileData.stats.untranslated} untranslated`}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="error-banner" role="alert" style={{ fontSize: 12 }}>
            {error}
          </div>
        )}

        {/* Run button */}
        <button
          className="btn btn-primary"
          style={{ width: "100%" }}
          onClick={handleRun}
          disabled={isRunning || !fileData || !anyCheckSelected}
          aria-busy={isRunning}
        >
          {isRunning ? (
            <>
              <span className="spinner" aria-hidden="true" style={{ marginRight: 6 }} />
              Running…
            </>
          ) : (
            "Run checks"
          )}
        </button>

        {state !== "idle" && !isRunning && (
          <button className="btn btn-ghost btn-sm" onClick={handleReset} style={{ width: "100%" }}>
            Reset
          </button>
        )}
      </div>

      {/* ── Right panel: results / triage / idle ──────────────────────────── */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {renderRight()}
      </div>

    </div>
  );
}
