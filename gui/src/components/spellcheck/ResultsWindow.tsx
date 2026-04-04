import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { FlaggedWord } from "./TriageWindow";
import { Segment, Settings, Violation } from "./SpellcheckPanel";

interface Props {
  realErrors: FlaggedWord[];
  filePath: string;
  settings: Settings;
  onBack: () => void;
  violations?: Violation[];
}

const VIOLATION_LABELS: Record<string, string> = {
  dnt_translated: "DNT translated",
  missing_required: "Missing term",
  forbidden_found: "Forbidden term",
  rule_violation: "Rule violation",
  number_mismatch: "Number mismatch",
  placeholder_mismatch: "Placeholder mismatch",
  unpaired_symbol: "Unpaired symbol",
  untranslated: "Untranslated",
  source_equals_target: "Source = Target",
  inconsistent_source: "Inconsistent (same source)",
  inconsistent_target: "Inconsistent (same target)",
  tag_mismatch: "Tag mismatch",
  url_email_mismatch: "URL/Email mismatch",
  alphanumeric_mismatch: "Alphanumeric mismatch",
  double_blanks: "Double blanks",
  repeated_words: "Repeated words",
  uppercase_mismatch: "UPPERCASE mismatch",
  camelcase_mismatch: "CamelCase mismatch",
};

// Badge class by violation category
const _QA_BADGE_CLASSES: Record<string, string> = {
  // Terminology
  dnt_translated: "badge-error",
  missing_required: "badge-warn",
  forbidden_found: "badge-error",
  rule_violation: "badge-warn",
  // Number/placeholder/symbol
  number_mismatch: "badge-orange",
  placeholder_mismatch: "badge-orange",
  unpaired_symbol: "badge-orange",
  // QA: translation completeness
  untranslated: "badge-warn",
  source_equals_target: "badge-warn",
  inconsistent_source: "badge-warn",
  inconsistent_target: "badge-warn",
  // QA: formatting
  tag_mismatch: "badge-error",
  double_blanks: "badge-info",
  repeated_words: "badge-info",
  // QA: content matching
  url_email_mismatch: "badge-info",
  alphanumeric_mismatch: "badge-info",
  uppercase_mismatch: "badge-info",
  camelcase_mismatch: "badge-info",
};

function getViolationBadgeClass(violationType: string): string {
  return _QA_BADGE_CLASSES[violationType] ?? "badge-warn";
}

/**
 * Highlights `word` in `text` using <mark> (semantically correct, WCAG 1.3.1).
 */
function highlightWord(text: string, word: string): React.ReactNode {
  if (!word) return text;
  const parts = text.split(
    new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi")
  );
  return parts.map((part, i) =>
    part.toLowerCase() === word.toLowerCase() ? (
      <mark key={i} className="highlight-word">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

type SidebarItem =
  | { kind: "spell"; fw: FlaggedWord }
  | { kind: "term"; violation: Violation; idx: number };

export default function ResultsWindow({ realErrors, filePath, settings, onBack, violations }: Props) {
  const isCombined = violations !== undefined;

  // Selection — only one active at a time
  const [selectedWord, setSelectedWord] = useState<FlaggedWord | null>(null);
  const [selectedViolationIdx, setSelectedViolationIdx] = useState<number | null>(null);

  // Spell detail state
  const [segments, setSegments] = useState<Segment[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [exporting, setExporting] = useState(false);

  // Ignore / collapse state (Step 7)
  const [ignoredItems, setIgnoredItems] = useState<Set<string>>(new Set());
  const [ignoredTypes, setIgnoredTypes] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [violationEdits, setViolationEdits] = useState<Record<string, string>>({});
  const [violSaving, setViolSaving] = useState(false);
  const [violSaveResult, setViolSaveResult] = useState("");

  // Auto-select first item
  useEffect(() => {
    if (realErrors.length > 0) {
      setSelectedWord(realErrors[0]);
      setSelectedViolationIdx(null);
    } else if (isCombined && violations.length > 0) {
      setSelectedViolationIdx(0);
      setSelectedWord(null);
    }
  }, []);

  function selectSpellItem(fw: FlaggedWord) {
    setSelectedWord(fw);
    setSelectedViolationIdx(null);
  }

  function selectTermItem(idx: number) {
    setSelectedViolationIdx(idx);
    setSelectedWord(null);
  }

  useEffect(() => {
    if (selectedWord) {
      loadSegments(selectedWord);
      loadSuggestions(selectedWord.word);
    }
  }, [selectedWord]);

  async function loadSegments(fw: FlaggedWord) {
    setLoading(true);
    setError("");
    try {
      const result = await invoke<{ segments: Segment[]; word: string }>(
        "get_segments_for_word",
        { filePath, word: fw.word, dics: settings.selected_dics }
      );
      setSegments(result.segments);
      const init: Record<string, string> = {};
      result.segments.forEach((s) => (init[s.id] = s.target));
      setEdits((prev) => ({ ...init, ...prev }));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadSuggestions(word: string) {
    if (!settings.selected_dics.length) return;
    try {
      const result = await invoke<{ suggestions: string[] }>("get_suggestions", {
        word,
        dics: settings.selected_dics,
      });
      setSuggestions(result.suggestions);
    } catch {
      setSuggestions([]);
    }
  }

  function ignoreItem(itemId: string) {
    setIgnoredItems(prev => {
      const next = new Set(prev);
      next.add(itemId);
      return next;
    });
  }

  function ignoreType(vtype: string) {
    setIgnoredTypes(prev => {
      const next = new Set(prev);
      next.add(vtype);
      return next;
    });
  }

  function restoreAll() {
    setIgnoredItems(new Set());
    setIgnoredTypes(new Set());
  }

  function toggleGroup(groupKey: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }

  async function saveViolationEdit(segId: string, newTarget: string) {
    setViolSaving(true);
    setViolSaveResult("");
    try {
      const result = await invoke<{ ok: boolean; backup_path: string }>(
        "apply_spellcheck_edits",
        { filePath, edits: JSON.stringify([{ id: segId, target: newTarget }]) }
      );
      setViolSaveResult(`Saved${result.backup_path ? ` · Backup: ${result.backup_path}` : ""}`);
    } catch (e) {
      console.error(e);
    } finally {
      setViolSaving(false);
    }
  }

  function applySuggestion(segId: string, suggestion: string) {
    if (!selectedWord) return;
    const current = edits[segId] || "";
    const regex = new RegExp(
      `(?<!\\w)${selectedWord.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\w)`,
      "gi"
    );
    const updated = current.replace(regex, suggestion);
    setEdits((prev) => ({ ...prev, [segId]: updated }));
  }

  async function saveAll() {
    setSaving(true);
    setSaveResult("");
    setError("");
    try {
      const editList = Object.entries(edits)
        .map(([id, target]) => ({ id, target }))
        .filter(({ id, target }) => {
          const original = segments.find((s) => s.id === id)?.target;
          return original !== undefined && target !== original;
        });

      if (editList.length === 0) {
        setSaveResult("No changes to save.");
        setSaving(false);
        return;
      }

      const result = await invoke<{ ok: boolean; backup_path: string }>(
        "apply_spellcheck_edits",
        { filePath, edits: JSON.stringify(editList) }
      );
      setSaveResult(
        `Saved ${editList.length} segment${editList.length !== 1 ? "s" : ""}. Backup: ${result.backup_path}`
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function buildCsvReport(): string {
    const q = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const fileName = filePath.split("/").pop() ?? filePath;
    const date = new Date().toLocaleString();
    const lines: string[] = [];

    lines.push("QA REPORT");
    lines.push(`File:,${q(fileName)}`);
    lines.push(`Date:,${q(date)}`);
    lines.push(`Spelling errors:,${realErrors.length}`);
    lines.push(`Other violations:,${violations?.length ?? 0}`);
    lines.push("");

    const hasErrors = realErrors.length > 0 || (violations && violations.length > 0);

    if (!hasErrors) {
      lines.push("No issues found — QA check passed.");
      return lines.join("\n");
    }

    if (realErrors.length > 0) {
      lines.push("SPELLCHECK ERRORS");
      lines.push("Word,Count,Segment IDs");
      for (const fw of realErrors) {
        lines.push(`${q(fw.word)},${fw.count},${q(fw.segment_ids.join(", "))}`);
      }
    }

    if (violations && violations.length > 0) {
      if (realErrors.length > 0) lines.push("");
      lines.push("OTHER VIOLATIONS");
      lines.push("Segment ID,File,Type,Source Term,Target Term,Description");
      for (const v of violations) {
        lines.push(
          `${q(v.segment_id)},${q(v.file_name)},${q(VIOLATION_LABELS[v.violation_type] ?? v.violation_type)},${q(v.source_term)},${q(v.target_term ?? "")},${q(v.description)}`
        );
      }
    }

    return lines.join("\n");
  }

  function buildHtmlReport(): string {
    const fileName = filePath.split("/").pop() ?? filePath;
    const date = new Date().toLocaleString();
    const spellCount = realErrors.length;
    const violCount = violations?.length ?? 0;
    const hasErrors = spellCount > 0 || violCount > 0;

    const esc = (s: string) =>
      String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const spellRows = realErrors
      .map(
        (fw) =>
          `<tr><td>${esc(fw.word)}</td><td>${fw.count}</td><td>${esc(fw.segment_ids.join(", "))}</td></tr>`
      )
      .join("\n");

    const violRows = (violations ?? [])
      .map((v) => {
        const typeLabel = VIOLATION_LABELS[v.violation_type] ?? v.violation_type;
        const badgeClass = getViolationBadgeClass(v.violation_type);
        return `<tr>
          <td>#${esc(v.segment_id)}</td>
          <td>${esc(v.file_name)}</td>
          <td><span class="badge ${badgeClass}">${esc(typeLabel)}</span></td>
          <td>${esc(v.source_term)}${v.target_term ? ` → ${esc(v.target_term)}` : ""}</td>
          <td>${esc(v.description)}</td>
          <td class="seg-text">${esc(v.source_text)}</td>
          <td class="seg-text">${esc(v.target_text)}</td>
        </tr>`;
      })
      .join("\n");

    const spellSection =
      spellCount > 0
        ? `<h2><span class="badge badge-red">Spelling errors (${spellCount})</span></h2>
<table>
  <thead><tr><th>Word</th><th>Count</th><th>Segment IDs</th></tr></thead>
  <tbody>${spellRows}</tbody>
</table>`
        : "";

    const violSection =
      violCount > 0
        ? `<h2><span class="badge badge-yellow">Other violations (${violCount})</span></h2>
<table>
  <thead><tr><th>Seg #</th><th>File</th><th>Type</th><th>Term</th><th>Description</th><th>Source</th><th>Target</th></tr></thead>
  <tbody>${violRows}</tbody>
</table>`
        : "";

    const noIssues = !hasErrors
      ? `<p class="pass">✓ No issues found — QA check passed.</p>`
      : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>QA Report — ${esc(fileName)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px; color: #1d1d1f; margin: 0; padding: 24px 32px; background: #f5f5f7; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; margin: 24px 0 8px; }
  .meta { color: #6e6e73; font-size: 12px; margin-bottom: 24px; }
  .summary { display: flex; gap: 16px; margin-bottom: 24px; }
  .summary-card { background: #fff; border-radius: 8px; padding: 12px 20px; min-width: 120px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .summary-card .num { font-size: 28px; font-weight: 700; line-height: 1; }
  .summary-card .lbl { font-size: 11px; color: #6e6e73; margin-top: 2px; }
  .num-red { color: #ff3b30; }
  .num-yellow { color: #ff9f0a; }
  .num-green { color: #34c759; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); margin-bottom: 24px; }
  thead { background: #f0f0f5; }
  th { text-align: left; padding: 8px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; color: #6e6e73; font-weight: 600; }
  td { padding: 8px 12px; border-top: 1px solid #f0f0f5; vertical-align: top; }
  tr:hover td { background: #fafafa; }
  .seg-text { max-width: 220px; white-space: pre-wrap; word-break: break-word; color: #444; font-size: 12px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
  .badge-red { background: rgba(255,59,48,.12); color: #c0392b; }
  .badge-yellow { background: rgba(255,159,10,.12); color: #b7860e; }
  .badge-orange { background: rgba(255,95,0,.12); color: #c0550e; }
  .pass { color: #34c759; font-size: 15px; font-weight: 600; margin: 32px 0; }
</style>
</head>
<body>
<h1>QA Report</h1>
<p class="meta">${esc(fileName)} &nbsp;·&nbsp; ${esc(date)}</p>
<div class="summary">
  <div class="summary-card"><div class="num ${spellCount > 0 ? "num-red" : "num-green"}">${spellCount}</div><div class="lbl">Spelling errors</div></div>
  <div class="summary-card"><div class="num ${violCount > 0 ? "num-yellow" : "num-green"}">${violCount}</div><div class="lbl">Other violations</div></div>
</div>
${noIssues}
${spellSection}
${violSection}
</body>
</html>`;
  }

  async function exportReport(format: "csv" | "html") {
    const baseName = filePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "report";
    const isHtml = format === "html";
    const defaultPath = `${baseName}-qa-report.${isHtml ? "html" : "csv"}`;
    const path = await saveDialog({
      defaultPath,
      filters: isHtml
        ? [{ name: "HTML", extensions: ["html"] }]
        : [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!path) return;

    setExporting(true);
    try {
      const content = isHtml ? buildHtmlReport() : buildCsvReport();
      await invoke("sc_save_report", { path, content });
      setSaveResult(`Report exported to ${path.split("/").pop()}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  }

  const hasChanges = segments.some(
    (s) => edits[s.id] !== undefined && edits[s.id] !== s.target
  );

  // Build sidebar items
  const spellItems: SidebarItem[] = realErrors.map((fw) => ({ kind: "spell", fw }));
  const termItems: SidebarItem[] = isCombined
    ? violations.map((v, i) => ({ kind: "term", violation: v, idx: i }))
    : [];
  const totalCount = spellItems.length + termItems.length;

  const selectedViolation =
    selectedViolationIdx !== null && isCombined ? violations[selectedViolationIdx] : null;

  // Keyboard handler for sidebar items
  function handleSidebarKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = Array.from(
        e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="option"]') ?? []
      );
      const idx = items.indexOf(e.currentTarget as HTMLElement);
      const next = e.key === "ArrowDown" ? items[idx + 1] : items[idx - 1];
      if (next) next.focus();
    }
  }

  function renderSpellSidebarItem(fw: FlaggedWord) {
    const isSelected = selectedWord?.word === fw.word;
    const itemId = `spell:${fw.word}`;
    return (
      <li
        key={`spell-${fw.word}`}
        role="option"
        aria-selected={isSelected}
        tabIndex={isSelected ? 0 : -1}
        className={`sidebar-item${isCombined ? " sidebar-item--spell" : ""}${isSelected ? " selected" : ""}`}
        onClick={() => selectSpellItem(fw)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectSpellItem(fw); }
          handleSidebarKeyDown(e);
        }}
      >
        {isCombined && <span className="sidebar-item__type-icon" aria-hidden="true">Aa</span>}
        <span className="word">{fw.word}</span>
        <span className="count" aria-label={`${fw.count} occurrences`}>
          {fw.count}x
        </span>
        <button
          className="sidebar-item-ignore-btn"
          onClick={(e) => { e.stopPropagation(); ignoreItem(itemId); }}
          aria-label="Ignore this item"
          title="Ignore"
        >✕</button>
      </li>
    );
  }

  function renderTermSidebarItem(violation: Violation, idx: number) {
    const isSelected = selectedViolationIdx === idx;
    const label = VIOLATION_LABELS[violation.violation_type] || violation.violation_type;
    const itemId = `viol:${violation.segment_id}:${violation.violation_type}:${violation.source_term}`;
    return (
      <li
        key={`term-${idx}`}
        role="option"
        aria-selected={isSelected}
        tabIndex={isSelected ? 0 : -1}
        className={`sidebar-item sidebar-item--term${isSelected ? " selected" : ""}`}
        onClick={() => selectTermItem(idx)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectTermItem(idx); }
          handleSidebarKeyDown(e);
        }}
      >
        {isCombined && <span className="sidebar-item__type-icon" aria-hidden="true">T</span>}
        <span className="word" style={{ flex: 1 }}>
          {violation.source_term}
          <span style={{ fontWeight: 400, color: "var(--text-secondary)", fontSize: 11, marginLeft: 6 }}>
            {label}
          </span>
        </span>
        <span className="count" style={{ fontSize: 11 }}>#{violation.segment_id}</span>
        <button
          className="sidebar-item-ignore-btn"
          onClick={(e) => { e.stopPropagation(); ignoreItem(itemId); }}
          aria-label="Ignore this item"
          title="Ignore"
        >✕</button>
      </li>
    );
  }

  function renderIgnoredCounter() {
    const totalIgnored = ignoredItems.size + (violations ?? []).filter(v => ignoredTypes.has(v.violation_type)).length;
    if (ignoredItems.size === 0 && ignoredTypes.size === 0) return null;
    return (
      <div style={{ padding: "4px 14px", display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
          {totalIgnored} ignored
        </span>
        <button className="btn btn-ghost btn-sm" onClick={restoreAll}>Restore all</button>
      </div>
    );
  }

  function renderSidebarContent() {
    if (!isCombined) {
      // Standalone spell-only mode
      const visibleSpell = realErrors.filter(fw => !ignoredItems.has(`spell:${fw.word}`));
      return (
        <>
          {renderIgnoredCounter()}
          <ul
            role="listbox"
            aria-labelledby="errors-list-heading"
            aria-label="Select an error word to review"
            style={{ listStyle: "none", padding: 0, margin: 0 }}
          >
            {visibleSpell.map((fw) => renderSpellSidebarItem(fw))}
          </ul>
        </>
      );
    }

    // Filter ignored items
    const visibleSpell = realErrors.filter(fw => !ignoredItems.has(`spell:${fw.word}`));
    const visibleViol = (violations ?? []).filter(v => {
      const id = `viol:${v.segment_id}:${v.violation_type}:${v.source_term}`;
      return !ignoredItems.has(id) && !ignoredTypes.has(v.violation_type);
    });

    // Collapsible groups for combined mode
    const spellGroup = visibleSpell;
    const termlistGroup = visibleViol.filter(v => v.check_source === "termlist");
    const checklistGroup = visibleViol.filter(v => v.check_source === "checklist");
    const qaGroup = visibleViol.filter(v => v.check_source === "number" || v.check_source === "qa");

    // Map visible violations to original indices for selection
    const violOriginalIndices = new Map<Violation, number>();
    (violations ?? []).forEach((v, i) => violOriginalIndices.set(v, i));

    function renderGroupHeader(groupKey: string, groupLabel: string, count: number) {
      return (
        <button
          key={`header-${groupKey}`}
          className="sidebar-group-header"
          onClick={() => toggleGroup(groupKey)}
          aria-expanded={!collapsedGroups.has(groupKey)}
        >
          <span aria-hidden="true">{collapsedGroups.has(groupKey) ? "▶" : "▼"}</span>
          {groupLabel} ({count})
        </button>
      );
    }

    return (
      <>
        {renderIgnoredCounter()}
        <div role="listbox" aria-labelledby="errors-list-heading" aria-label="Select an item to review">
          {/* Spell group */}
          {(spellGroup.length > 0 || realErrors.length > 0) && (
            <>
              {renderGroupHeader("spell", "Spelling", spellGroup.length)}
              {!collapsedGroups.has("spell") && (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {spellGroup.map((fw) => renderSpellSidebarItem(fw))}
                </ul>
              )}
            </>
          )}
          {/* Termlist group */}
          {(termlistGroup.length > 0 || (violations ?? []).some(v => v.check_source === "termlist")) && (
            <>
              {renderGroupHeader("termlist", "Termlist", termlistGroup.length)}
              {!collapsedGroups.has("termlist") && (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {termlistGroup.map((v) => {
                    const idx = violOriginalIndices.get(v) ?? 0;
                    return renderTermSidebarItem(v, idx);
                  })}
                </ul>
              )}
            </>
          )}
          {/* Checklist group */}
          {(checklistGroup.length > 0 || (violations ?? []).some(v => v.check_source === "checklist")) && (
            <>
              {renderGroupHeader("checklist", "Checklist", checklistGroup.length)}
              {!collapsedGroups.has("checklist") && (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {checklistGroup.map((v) => {
                    const idx = violOriginalIndices.get(v) ?? 0;
                    return renderTermSidebarItem(v, idx);
                  })}
                </ul>
              )}
            </>
          )}
          {/* QA group */}
          {(qaGroup.length > 0 || (violations ?? []).some(v => v.check_source === "number" || v.check_source === "qa")) && (
            <>
              {renderGroupHeader("qa", "QA / Numbers", qaGroup.length)}
              {!collapsedGroups.has("qa") && (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {qaGroup.map((v) => {
                    const idx = violOriginalIndices.get(v) ?? 0;
                    return renderTermSidebarItem(v, idx);
                  })}
                </ul>
              )}
            </>
          )}
        </div>
      </>
    );
  }

  // Main panel: spell detail
  function renderSpellDetail() {
    if (!selectedWord) return null;
    return (
      <>
        {/* Word heading + suggestions toolbar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600 }}>
            <span className="sr-only">Reviewing word:</span>
            &ldquo;{selectedWord.word}&rdquo;
          </h2>

          <div
            className="suggestions-row"
            role="group"
            aria-label={`Suggestions for "${selectedWord.word}"`}
          >
            <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Suggestions:
            </span>
            {suggestions.length > 0 ? (
              suggestions.map((s) => (
                <button
                  key={s}
                  className="suggestion-chip"
                  title={`Apply "${s}" to all segments`}
                  aria-label={`Apply suggestion "${s}" to all segments`}
                  onClick={() => segments.forEach((seg) => applySuggestion(seg.id, s))}
                >
                  {s}
                </button>
              ))
            ) : (
              <span
                style={{ fontSize: 12, color: "var(--text-secondary)" }}
                aria-live="polite"
              >
                No suggestions
              </span>
            )}
          </div>

          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button
              className="btn btn-primary"
              onClick={saveAll}
              disabled={saving || !hasChanges}
              aria-busy={saving}
              aria-label={
                saving
                  ? "Saving changes..."
                  : hasChanges
                  ? "Save all changes to XLIFF file"
                  : "No changes to save"
              }
            >
              {saving ? (
                <>
                  <span className="spinner" aria-hidden="true" style={{ marginRight: 6 }} />
                  Saving...
                </>
              ) : (
                "Save all changes"
              )}
            </button>
          </div>
        </div>

        {loading && (
          <div className="empty-state" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <span style={{ marginLeft: 8 }}>Loading segments...</span>
          </div>
        )}

        {!loading && segments.length === 0 && (
          <div className="empty-state">
            <h3>No segments found</h3>
            <p>The word may have been corrected in a previous save.</p>
          </div>
        )}

        {!loading &&
          segments.map((seg) => (
            <article key={seg.id} className="segment-card" aria-label={`Segment ${seg.id}`}>
              <header className="segment-card-header">
                <span>{seg.file_name}</span>
                <span style={{ color: "var(--text-secondary)" }} aria-label={`Segment ID ${seg.id}`}>
                  #{seg.id}
                </span>
              </header>
              <div className="segment-card-body">
                <div>
                  <div className="segment-label" id={`src-label-${seg.id}`}>
                    Source
                  </div>
                  <div
                    className="segment-text"
                    aria-labelledby={`src-label-${seg.id}`}
                  >
                    {seg.source}
                  </div>
                </div>
                <div>
                  <div className="segment-label" id={`tgt-label-${seg.id}`}>
                    Target (current)
                  </div>
                  <div
                    className="segment-text"
                    aria-labelledby={`tgt-label-${seg.id}`}
                  >
                    {highlightWord(edits[seg.id] ?? seg.target, selectedWord.word)}
                  </div>
                </div>
                <div>
                  <label
                    htmlFor={`edit-${seg.id}`}
                    className="segment-label"
                  >
                    Edit target
                  </label>
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <textarea
                        id={`edit-${seg.id}`}
                        rows={2}
                        value={edits[seg.id] ?? seg.target}
                        onChange={(e) =>
                          setEdits((prev) => ({ ...prev, [seg.id]: e.target.value }))
                        }
                        aria-label={`Edit target for segment ${seg.id}`}
                      />
                    </div>
                    {suggestions.length > 0 && (
                      <div
                        style={{ display: "flex", flexDirection: "column", gap: 4 }}
                        role="group"
                        aria-label={`Apply suggestion to segment ${seg.id}`}
                      >
                        {suggestions.map((s) => (
                          <button
                            key={s}
                            className="suggestion-chip"
                            style={{ fontSize: 11 }}
                            aria-label={`Apply "${s}" to segment ${seg.id}`}
                            onClick={() => applySuggestion(seg.id, s)}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </article>
          ))}
      </>
    );
  }

  // Main panel: violation detail
  function renderViolationDetail() {
    if (!selectedViolation) return null;
    const label = VIOLATION_LABELS[selectedViolation.violation_type] || selectedViolation.violation_type;
    const editedTarget = violationEdits[selectedViolation.segment_id];
    const hasViolEdit = editedTarget !== undefined && editedTarget !== selectedViolation.target_text;
    return (
      <>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
          Violation — {label}
        </h2>
        <article className="segment-card" aria-label={`Violation in segment ${selectedViolation.segment_id}`}>
          <header className="segment-card-header">
            <span>{selectedViolation.file_name}</span>
            <span style={{ color: "var(--text-secondary)" }}>#{selectedViolation.segment_id}</span>
          </header>
          <div className="segment-card-body">
            <div>
              <div className="segment-label">Source</div>
              <div className="segment-text">{selectedViolation.source_text}</div>
            </div>
            <div>
              <div className="segment-label">Edit target</div>
              <textarea
                className="segment-edit-textarea"
                rows={3}
                value={editedTarget ?? selectedViolation.target_text}
                onChange={(e) => setViolationEdits(prev => ({ ...prev, [selectedViolation.segment_id]: e.target.value }))}
                style={{ width: "100%", fontFamily: "inherit", fontSize: 13, padding: 8, borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", resize: "vertical" }}
              />
              {hasViolEdit && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => saveViolationEdit(selectedViolation.segment_id, editedTarget)}
                  disabled={violSaving}
                  style={{ marginTop: 6 }}
                >
                  {violSaving ? "Saving…" : "Save changes"}
                </button>
              )}
              {violSaveResult && <div style={{ fontSize: 11, color: "var(--success)", marginTop: 4 }}>{violSaveResult}</div>}
            </div>
            <div>
              <div className="segment-label">Term</div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                {selectedViolation.source_term}
                {selectedViolation.target_term && (
                  <span style={{ fontWeight: 400, color: "var(--text-secondary)" }}>
                    {" -> "}{selectedViolation.target_term}
                  </span>
                )}
              </div>
            </div>
          </div>
        </article>
        <div
          className="term-detail-card"
          role="note"
          aria-label="Violation description"
        >
          {selectedViolation.description}
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => ignoreType(selectedViolation.violation_type)}
          style={{ marginTop: 8 }}
        >
          Ignore all "{label}"
        </button>
      </>
    );
  }

  return (
    <div className="results-layout">
      {/* Sidebar */}
      <nav
        className="results-sidebar"
        aria-label={isCombined ? "Results list" : "Errors list"}
      >
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600 }} id="errors-list-heading">
            {isCombined ? `RESULTS (${totalCount})` : `ERRORS (${realErrors.length})`}
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => exportReport("csv")}
              disabled={exporting}
              aria-busy={exporting}
              aria-label="Export QA report as CSV"
              title="Export as CSV"
            >
              {exporting ? "Exporting…" : "CSV"}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => exportReport("html")}
              disabled={exporting}
              aria-busy={exporting}
              aria-label="Export QA report as HTML"
              title="Export as HTML report"
            >
              HTML
            </button>
            <button className="btn btn-secondary btn-sm" onClick={onBack} aria-label="Back to triage">
              &larr; Back
            </button>
          </div>
        </div>
        {renderSidebarContent()}
      </nav>

      {/* Main panel */}
      <main className="results-main" aria-label={selectedWord ? "Segment editor" : "Violation detail"}>
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        {saveResult && (
          <div
            role="status"
            aria-live="polite"
            style={{
              background: "rgba(50,215,75,0.1)",
              border: "1px solid var(--success)",
              borderRadius: "var(--radius)",
              padding: "10px 14px",
              fontSize: 13,
              marginBottom: 12,
              color: "var(--success)",
            }}
          >
            {saveResult}
          </div>
        )}

        {selectedWord && renderSpellDetail()}
        {selectedViolation && renderViolationDetail()}

        {!selectedWord && !selectedViolation && (
          <div className="empty-state">
            <h3>No item selected</h3>
            <p>Select an item from the list on the left to begin reviewing.</p>
          </div>
        )}
      </main>
    </div>
  );
}
