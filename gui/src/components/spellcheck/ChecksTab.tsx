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

type RunState =
  | "idle"
  | "running_spell"
  | "triage"
  | "running_checks"
  | "results";

export default function ChecksTab({ fileData, filePath, settings, onSettingsChange }: Props) {
  // Which checks to run
  const [runSpell, setRunSpell] = useState(true);
  const [runTerm, setRunTerm] = useState(true);
  const [runChecklist, setRunChecklist] = useState(true);
  const [runQA, setRunQA] = useState(true);

  const [state, setState] = useState<RunState>("idle");
  const [error, setError] = useState("");

  // Spellcheck triage state
  const [flaggedWords, setFlaggedWords] = useState<FlaggedWord[]>([]);
  const [realErrors, setRealErrors] = useState<FlaggedWord[]>([]);

  // Final results
  const [violations, setViolations] = useState<Violation[]>([]);

  const enabledTermlists = settings.termlists.filter((t) => t.enabled).map((t) => t.path);
  const enabledChecklists = settings.checklists.filter((c) => c.enabled).map((c) => c.path);

  const anyCheckSelected = runSpell || runTerm || runChecklist || runQA;
  const needsDics = runSpell && settings.selected_dics.length === 0;

  async function handleRun() {
    if (!filePath || !fileData) { setError("Ingen fil lastet. Åpne en XLIFF-fil først."); return; }
    if (needsDics) { setError("Ingen ordbøker valgt. Velg ordbøker i Settings."); return; }

    setError("");
    setViolations([]);
    setFlaggedWords([]);
    setRealErrors([]);

    if (runSpell) {
      // Spellcheck first — needs triage
      setState("running_spell");
      try {
        const exclusionFiles = [...enabledTermlists, ...enabledChecklists];
        const result = await invoke<{ flagged_words: FlaggedWord[] }>("sc_run_spellcheck", {
          filePath,
          dics: settings.selected_dics,
          exclusionFiles,
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
      // Skip spellcheck — go straight to other checks
      await runOtherChecks([]);
    }
  }

  async function runOtherChecks(confirmedErrors: FlaggedWord[]) {
    setRealErrors(confirmedErrors);

    const hasTermWork = (runTerm && enabledTermlists.length > 0) ||
                        (runChecklist && enabledChecklists.length > 0);

    if (!runTerm && !runChecklist && !runQA) {
      // Spell-only
      setState("results");
      return;
    }

    setState("running_checks");
    try {
      const enabledQaIds = Object.entries(settings.qa_checks ?? {})
        .filter(([, on]) => on).map(([id]) => id).join(",") || "none";

      const termlistPaths = runTerm ? enabledTermlists : [];
      const checklistPaths = runChecklist ? enabledChecklists : [];

      const promises: Promise<{ violations: Violation[] }>[] = [];

      if (hasTermWork && (termlistPaths.length > 0 || checklistPaths.length > 0)) {
        promises.push(invoke<{ violations: Violation[] }>("sc_run_term_check", {
          filePath,
          termlists: termlistPaths,
          checklists: checklistPaths,
          skipLocked: settings.skip_locked ?? true,
          skip100Match: settings.skip_100_match ?? true,
        }));
      } else {
        promises.push(Promise.resolve({ violations: [] }));
      }

      promises.push(invoke<{ violations: Violation[] }>("sc_run_number_check", {
        filePath,
        skipLocked: settings.skip_locked ?? true,
        skip100Match: settings.skip_100_match ?? true,
      }));

      if (runQA) {
        promises.push(invoke<{ violations: Violation[] }>("sc_run_qa_checks", {
          filePath,
          skipLocked: settings.skip_locked ?? true,
          skip100Match: settings.skip_100_match ?? true,
          checks: enabledQaIds,
        }));
      } else {
        promises.push(Promise.resolve({ violations: [] }));
      }

      const [termResult, numberResult, qaResult] = await Promise.all(promises);
      setViolations([...termResult.violations, ...numberResult.violations, ...qaResult.violations]);
      setState("results");
    } catch (e) {
      setError(String(e));
      setState(confirmedErrors.length > 0 ? "results" : "idle");
    }
  }

  function handleTriageDone(confirmed: FlaggedWord[]) {
    runOtherChecks(confirmed);
  }

  function handleBack() {
    setState("triage");
  }

  function handleReset() {
    setState("idle");
    setError("");
    setFlaggedWords([]);
    setRealErrors([]);
    setViolations([]);
  }

  // ── Triage screen ────────────────────────────────────────────────────────────
  if (state === "triage") {
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

  // ── Running checks after triage ──────────────────────────────────────────────
  if (state === "running_checks") {
    return (
      <div className="spellcheck-main">
        <div className="empty-state" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <h2 style={{ fontSize: 15, marginTop: 12, marginBottom: 6, color: "var(--text-secondary)" }}>
            Kjører sjekker…
          </h2>
          <p>Terminologi, tall og formatering sjekkes.</p>
        </div>
      </div>
    );
  }

  // ── Results screen ───────────────────────────────────────────────────────────
  if (state === "results") {
    return (
      <div className="spellcheck-main">
        <ResultsWindow
          realErrors={realErrors}
          filePath={filePath}
          settings={settings}
          onBack={handleBack}
          violations={violations}
          onNewRun={handleReset}
        />
      </div>
    );
  }

  // ── Idle / running_spell ─────────────────────────────────────────────────────
  const isRunning = state === "running_spell";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "auto" }}>
      <div style={{ padding: "20px 24px", maxWidth: 620 }}>

        {/* Which checks to run */}
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-secondary)", marginBottom: 10 }}>
            Sjekker
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label className="checkbox-row">
              <input type="checkbox" checked={runSpell} onChange={e => setRunSpell(e.target.checked)} />
              <span>Stavekontroll</span>
              {settings.selected_dics.length === 0 && runSpell && (
                <span style={{ fontSize: 11, color: "var(--danger)", marginLeft: 8 }}>— ingen ordbøker valgt</span>
              )}
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={runTerm} onChange={e => setRunTerm(e.target.checked)} />
              <span>Terminologi ({enabledTermlists.length} termlist{enabledTermlists.length !== 1 ? "er" : ""})</span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={runChecklist} onChange={e => setRunChecklist(e.target.checked)} />
              <span>Sjekkliste ({enabledChecklists.length} fil{enabledChecklists.length !== 1 ? "er" : ""})</span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={runQA} onChange={e => setRunQA(e.target.checked)} />
              <span>QA-sjekker ({Object.values(settings.qa_checks ?? {}).filter(Boolean).length} aktive)</span>
            </label>
          </div>
        </section>

        {/* Segment filtering */}
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-secondary)", marginBottom: 10 }}>
            Segmentfilter
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.skip_locked ?? true}
                onChange={e => onSettingsChange({ ...settings, skip_locked: e.target.checked })}
              />
              <span>Hopp over låste segmenter</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.skip_100_match ?? true}
                onChange={e => onSettingsChange({ ...settings, skip_100_match: e.target.checked })}
              />
              <span>Hopp over 100%-TM-treff</span>
            </label>
          </div>
        </section>

        {/* File summary */}
        {fileData && (
          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--text-secondary)", marginBottom: 8 }}>
              Fil
            </h2>
            <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {filePath.split("/").pop()} &nbsp;·&nbsp; {fileData.stats.total_segments} segmenter
              {fileData.stats.untranslated > 0 && ` (${fileData.stats.untranslated} uoversatt)`}
            </div>
          </section>
        )}

        {/* Error */}
        {error && (
          <div className="error-banner" role="alert" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* Run button */}
        <button
          className="btn btn-primary"
          style={{ width: "100%", padding: "10px 0", fontSize: 15 }}
          onClick={handleRun}
          disabled={isRunning || !fileData || !anyCheckSelected}
          aria-busy={isRunning}
        >
          {isRunning ? (
            <>
              <span className="spinner" aria-hidden="true" style={{ marginRight: 8 }} />
              Kjører stavekontroll…
            </>
          ) : (
            "Kjør valgte sjekker"
          )}
        </button>

        {!fileData && (
          <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 10, textAlign: "center" }}>
            Åpne en XLIFF-fil for å starte.
          </p>
        )}
      </div>
    </div>
  );
}
