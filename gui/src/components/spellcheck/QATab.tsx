import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileData, Settings, Violation } from "./SpellcheckPanel";
import ExportBar from "./ExportBar";

interface Props {
  fileData: FileData | null;
  filePath: string;
  settings: Settings;
  onRunAll: () => void;
  runningAll: boolean;
}

const VIOLATION_LABELS: Record<string, { label: string; className: string }> = {
  dnt_translated: { label: "DNT translated", className: "badge-error" },
  missing_required: { label: "Missing term", className: "badge-warn" },
  forbidden_found: { label: "Forbidden term", className: "badge-error" },
  rule_violation: { label: "Rule violation", className: "badge-warn" },
  number_mismatch: { label: "Number mismatch", className: "badge-orange" },
  placeholder_mismatch: { label: "Placeholder mismatch", className: "badge-orange" },
  unpaired_symbol: { label: "Unpaired symbol", className: "badge-orange" },
  untranslated: { label: "Untranslated", className: "badge-warn" },
  source_equals_target: { label: "Source = Target", className: "badge-warn" },
  inconsistent_source: { label: "Inconsistent (same source)", className: "badge-warn" },
  inconsistent_target: { label: "Inconsistent (same target)", className: "badge-warn" },
  tag_mismatch: { label: "Tag mismatch", className: "badge-error" },
  url_email_mismatch: { label: "URL/Email mismatch", className: "badge-info" },
  alphanumeric_mismatch: { label: "Alphanumeric mismatch", className: "badge-info" },
  double_blanks: { label: "Double blanks", className: "badge-info" },
  repeated_words: { label: "Repeated words", className: "badge-info" },
  uppercase_mismatch: { label: "UPPERCASE mismatch", className: "badge-info" },
  camelcase_mismatch: { label: "CamelCase mismatch", className: "badge-info" },
};

export default function QATab({ fileData, filePath, settings, onRunAll, runningAll }: Props) {
  const [violations, setViolations] = useState<Violation[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>("");
  const [ran, setRan] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [ignoredItems, setIgnoredItems] = useState<Set<string>>(new Set());
  const [ignoredTypes, setIgnoredTypes] = useState<Set<string>>(new Set());
  const [violationEdits, setViolationEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState("");

  function itemKey(v: Violation): string {
    return `${v.segment_id}:${v.violation_type}:${v.source_term ?? ""}`;
  }

  async function runQAOnly() {
    if (!filePath || !fileData) {
      setError("No file loaded.");
      return;
    }

    setIgnoredItems(new Set());
    setIgnoredTypes(new Set());
    setViolationEdits({});
    setSaveResult("");
    setError("");
    setRunning(true);
    setRan(false);
    setViolations([]);
    setSelectedIdx(null);

    try {
      const enabledQaIds = Object.entries(settings.qa_checks ?? {})
        .filter(([, on]) => on)
        .map(([id]) => id)
        .join(",") || "none";

      const [numberResult, qaResult] = await Promise.all([
        invoke<{ violations: Violation[] }>("sc_run_number_check", {
          filePath,
          skipLocked: settings.skip_locked ?? true,
          skip100Match: settings.skip_100_match ?? true,
        }),
        invoke<{ violations: Violation[] }>("sc_run_qa_checks", {
          filePath,
          skipLocked: settings.skip_locked ?? true,
          skip100Match: settings.skip_100_match ?? true,
          checks: enabledQaIds,
        }),
      ]);

      setViolations([...numberResult.violations, ...qaResult.violations]);
      setRan(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  async function saveEdit(segId: string, newTarget: string) {
    setSaving(true);
    setSaveResult("");
    try {
      await invoke("sc_apply_spellcheck_edits", {
        filePath,
        edits: JSON.stringify([{ id: segId, target: newTarget }])
      });
      setSaveResult("Saved ✓");
      setTimeout(() => setSaveResult(""), 3000);
    } catch (e) {
      setSaveResult("Error saving");
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  // Compute visible violations (filter out ignored items/types)
  const visibleViolations = violations.filter(v => {
    const key = itemKey(v);
    return !ignoredItems.has(key) && !ignoredTypes.has(v.violation_type);
  });
  const ignoredCount = violations.length - visibleViolations.length;

  function ignoreItem(v: Violation) {
    const key = itemKey(v);
    setIgnoredItems(prev => new Set([...prev, key]));
    // advance selection if this was selected
    const newVisible = visibleViolations.filter(x => itemKey(x) !== key);
    if (newVisible.length === 0) {
      setSelectedIdx(null);
    } else if (selectedIdx !== null) {
      const cur = violations.indexOf(v);
      const nextVisible = newVisible.find((_, i) => {
        const origIdx = violations.indexOf(newVisible[i]);
        return origIdx >= cur;
      });
      if (nextVisible) {
        setSelectedIdx(violations.indexOf(nextVisible));
      } else {
        setSelectedIdx(violations.indexOf(newVisible[newVisible.length - 1]));
      }
    }
  }

  function ignoreType(violationType: string) {
    setIgnoredTypes(prev => new Set([...prev, violationType]));
    setSelectedIdx(null);
  }

  function restoreAll() {
    setIgnoredItems(new Set());
    setIgnoredTypes(new Set());
  }

  const selectedViol = selectedIdx !== null ? visibleViolations[selectedIdx] : null;

  function handleRowKeyDown(
    e: React.KeyboardEvent<HTMLTableRowElement>,
    idx: number
  ) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSelectedIdx(idx === selectedIdx ? null : idx);
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const rows = Array.from(
        e.currentTarget.parentElement?.querySelectorAll<HTMLElement>("[data-row]") ?? []
      );
      const current = rows.indexOf(e.currentTarget as HTMLElement);
      const next =
        e.key === "ArrowDown" ? rows[current + 1] : rows[current - 1];
      if (next) next.focus();
    }
  }

  return (
    <div
      style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}
    >
      {/* Toolbar */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", gap: 16, flex: 1, flexWrap: "wrap" }}>
          <div>
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>QA checks: </span>
            <span style={{ fontSize: 12 }}>
              {Object.values(settings.qa_checks ?? {}).filter(Boolean).length} active
            </span>
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={onRunAll}
          disabled={runningAll || !fileData}
          aria-busy={runningAll}
          aria-label={runningAll ? "Running all checks…" : "Run all checks"}
        >
          {runningAll ? (
            <>
              <span className="spinner" aria-hidden="true" style={{ marginRight: 6 }} />
              <span>Running…</span>
            </>
          ) : (
            "Run all checks"
          )}
        </button>
        <button
          className="btn btn-secondary"
          onClick={runQAOnly}
          disabled={running || !fileData || runningAll}
          aria-busy={running}
          aria-label={running ? "Running QA checks…" : "QA checks only"}
        >
          {running ? (
            <>
              <span className="spinner" aria-hidden="true" style={{ marginRight: 6 }} />
              <span>Checking…</span>
            </>
          ) : (
            "QA checks only"
          )}
        </button>
        {ran && violations.length > 0 && (
          <ExportBar filePath={filePath} spellErrors={[]} violations={violations} />
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ padding: 12 }}>
          <div className="error-banner" role="alert">
            {error}
          </div>
        </div>
      )}

      {/* Empty/idle state */}
      {!ran && !error && (
        <div className="empty-state" style={{ flex: 1 }}>
          <h2 style={{ fontSize: 15, marginBottom: 6, color: "var(--text-secondary)" }}>
            No results yet
          </h2>
          <p>
            {!fileData
              ? "Open an XLIFF file first, then click 'QA checks only'."
              : "Click 'QA checks only' to run number and QA checks, or 'Run all checks' for a full check."}
          </p>
        </div>
      )}

      {/* All-clear state */}
      {ran && violations.length === 0 && (
        <div className="empty-state" style={{ flex: 1 }} role="status" aria-live="polite">
          <h2 style={{ fontSize: 15, marginBottom: 6, color: "var(--text-secondary)" }}>
            No violations found
          </h2>
          <p>All checked segments passed the QA checks.</p>
        </div>
      )}

      {/* Results */}
      {ran && violations.length > 0 && (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Violations table */}
          <div
            style={{ flex: 1, overflowY: "auto" }}
            role="region"
            aria-label="QA violations"
          >
            <div
              style={{
                padding: "8px 14px",
                borderBottom: "1px solid var(--border)",
                fontSize: 12,
                color: "var(--text-secondary)",
              }}
              role="status"
              aria-live="polite"
            >
              {violations.length} violation{violations.length !== 1 ? "s" : ""} found
            </div>
            {ignoredCount > 0 && (
              <div style={{ padding: "4px 12px", background: "var(--surface2)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                <span style={{ color: "var(--text-secondary)" }}>{ignoredCount} ignored</span>
                <button className="btn btn-ghost btn-sm" onClick={restoreAll}>Restore all</button>
              </div>
            )}
            <table
              className="data-table"
              role="grid"
              aria-label="QA violations"
              aria-rowcount={visibleViolations.length}
            >
              <thead>
                <tr>
                  <th scope="col">Segment</th>
                  <th scope="col">File</th>
                  <th scope="col">Type</th>
                  <th scope="col">Term</th>
                  <th scope="col">Description</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {visibleViolations.map((v, i) => {
                  const meta =
                    VIOLATION_LABELS[v.violation_type] || {
                      label: v.violation_type,
                      className: "badge-warn",
                    };
                  const isSelected = selectedIdx === i;
                  return (
                    <tr
                      key={i}
                      data-row
                      className={isSelected ? "selected" : ""}
                      onClick={() => setSelectedIdx(i === selectedIdx ? null : i)}
                      onKeyDown={(e) => handleRowKeyDown(e, i)}
                      tabIndex={0}
                      role="row"
                      aria-rowindex={i + 2}
                      aria-selected={isSelected}
                      aria-label={`Segment ${v.segment_id}: ${meta.label} — ${v.source_term}${
                        v.target_term ? ` → ${v.target_term}` : ""
                      }. ${v.description}`}
                      style={{ cursor: "pointer" }}
                    >
                      <td style={{ fontFamily: "monospace", fontSize: 12 }}>
                        #{v.segment_id}
                      </td>
                      <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                        {v.file_name}
                      </td>
                      <td>
                        <span className={`badge ${meta.className}`} aria-label={meta.label}>
                          {meta.label}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600 }}>
                        {v.source_term}
                        {v.target_term && (
                          <span style={{ color: "var(--text-secondary)", fontWeight: 400 }}>
                            {" "}→ {v.target_term}
                          </span>
                        )}
                      </td>
                      <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                        {v.description}
                      </td>
                      <td>
                        <button
                          className="sidebar-item-ignore-btn"
                          onClick={(e) => { e.stopPropagation(); ignoreItem(v); }}
                          title="Ignore"
                          aria-label="Ignore this violation"
                        >✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Detail panel */}
          {selectedViol && (
            <aside
              style={{
                width: 360,
                borderLeft: "1px solid var(--border)",
                overflow: "auto",
                padding: 16,
                flexShrink: 0,
              }}
              aria-label={`Violation detail for segment ${selectedViol.segment_id}`}
            >
              <div style={{ marginBottom: 12 }}>
                <div className="segment-label" id="qa-detail-seg-label">
                  Segment #{selectedViol.segment_id}
                </div>
                <div
                  className="segment-label"
                  style={{ marginTop: 8 }}
                  id="qa-detail-src-label"
                >
                  Source
                </div>
                <div
                  className="segment-text"
                  aria-labelledby="qa-detail-src-label"
                >
                  {selectedViol.source_text}
                </div>
                <div
                  className="segment-label"
                  style={{ marginTop: 8 }}
                  id="qa-detail-tgt-label"
                >
                  Target
                </div>
                <div
                  className="segment-text"
                  aria-labelledby="qa-detail-tgt-label"
                >
                  {selectedViol.target_text}
                </div>
              </div>
              <div
                role="note"
                aria-label="Violation description"
                style={{
                  padding: "8px 12px",
                  background: "rgba(255,214,10,0.1)",
                  border: "1px solid var(--warning)",
                  borderRadius: "var(--radius)",
                  fontSize: 12,
                }}
              >
                {selectedViol.description}
              </div>

              {/* Editable target */}
              <div style={{ marginTop: 12 }}>
                <div className="segment-label" style={{ marginBottom: 4 }}>Edit target</div>
                <textarea
                  className="segment-edit-textarea"
                  rows={3}
                  value={violationEdits[selectedViol.segment_id] ?? selectedViol.target_text ?? ""}
                  onChange={e => setViolationEdits(prev => ({ ...prev, [selectedViol.segment_id]: e.target.value }))}
                  style={{ width: "100%", fontFamily: "inherit", fontSize: 13, padding: 8, borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", resize: "vertical", boxSizing: "border-box" }}
                />
                {violationEdits[selectedViol.segment_id] !== undefined &&
                 violationEdits[selectedViol.segment_id] !== selectedViol.target_text && (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => saveEdit(selectedViol.segment_id, violationEdits[selectedViol.segment_id])}
                    disabled={saving}
                    style={{ marginTop: 6 }}
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                )}
                {saveResult && (
                  <div style={{ fontSize: 11, marginTop: 4, color: "var(--success)" }}>{saveResult}</div>
                )}
              </div>

              {/* Ignore actions */}
              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => ignoreItem(selectedViol)}
                >
                  Ignore this
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => ignoreType(selectedViol.violation_type)}
                >
                  Ignore all "{selectedViol.violation_type}"
                </button>
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
