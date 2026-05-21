import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { FlaggedWord } from "./TriageWindow";
import { Violation } from "./SpellcheckPanel";

interface Props {
  filePath: string;
  spellErrors: FlaggedWord[];
  violations: Violation[];
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

function buildCsvReport(filePath: string, spellErrors: FlaggedWord[], violations: Violation[]): string {
  const q = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const fileName = filePath.split("/").pop() ?? filePath;
  const date = new Date().toLocaleString();
  const lines: string[] = [];

  lines.push("QA REPORT");
  lines.push(`File:,${q(fileName)}`);
  lines.push(`Date:,${q(date)}`);
  lines.push(`Spelling errors:,${spellErrors.length}`);
  lines.push(`Other violations:,${violations.length}`);
  lines.push("");

  if (spellErrors.length === 0 && violations.length === 0) {
    lines.push("No issues found — QA check passed.");
    return lines.join("\n");
  }

  if (spellErrors.length > 0) {
    lines.push("SPELLCHECK ERRORS");
    lines.push("Word,Count,Segment IDs");
    for (const fw of spellErrors) {
      lines.push(`${q(fw.word)},${fw.count},${q(fw.segment_ids.join(", "))}`);
    }
  }

  if (violations.length > 0) {
    if (spellErrors.length > 0) lines.push("");
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

function buildHtmlReport(filePath: string, spellErrors: FlaggedWord[], violations: Violation[]): string {
  const fileName = filePath.split("/").pop() ?? filePath;
  const date = new Date().toLocaleString();
  const spellCount = spellErrors.length;
  const violCount = violations.length;
  const hasErrors = spellCount > 0 || violCount > 0;

  const esc = (s: string) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const spellRows = spellErrors
    .map(
      (fw) =>
        `<tr><td>${esc(fw.word)}</td><td>${fw.count}</td><td>${esc(fw.segment_ids.join(", "))}</td></tr>`
    )
    .join("\n");

  const violRows = violations
    .map((v) => {
      const typeLabel = VIOLATION_LABELS[v.violation_type] ?? v.violation_type;
      return `<tr>
        <td>#${esc(v.segment_id)}</td>
        <td>${esc(v.file_name)}</td>
        <td>${esc(typeLabel)}</td>
        <td>${esc(v.source_term)}${v.target_term ? ` → ${esc(v.target_term)}` : ""}</td>
        <td>${esc(v.description)}</td>
        <td class="seg-text">${esc(v.source_text)}</td>
        <td class="seg-text">${esc(v.target_text)}</td>
      </tr>`;
    })
    .join("\n");

  const spellSection =
    spellCount > 0
      ? `<h2>Spelling errors (${spellCount})</h2>
<table>
  <thead><tr><th>Word</th><th>Count</th><th>Segment IDs</th></tr></thead>
  <tbody>${spellRows}</tbody>
</table>`
      : "";

  const violSection =
    violCount > 0
      ? `<h2>Other violations (${violCount})</h2>
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
  .num-red { color: #ff3b30; } .num-yellow { color: #ff9f0a; } .num-green { color: #34c759; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); margin-bottom: 24px; }
  thead { background: #f0f0f5; }
  th { text-align: left; padding: 8px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; color: #6e6e73; font-weight: 600; }
  td { padding: 8px 12px; border-top: 1px solid #f0f0f5; vertical-align: top; }
  tr:hover td { background: #fafafa; }
  .seg-text { max-width: 220px; white-space: pre-wrap; word-break: break-word; color: #444; font-size: 12px; }
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

export default function ExportBar({ filePath, spellErrors, violations }: Props) {
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  async function exportReport(format: "csv" | "html" | "xlsx") {
    const baseName = filePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "report";
    const ext = format === "html" ? "html" : format === "xlsx" ? "xlsx" : "csv";
    const defaultPath = `${baseName}-qa-report.${ext}`;

    const filterMap = {
      html: [{ name: "HTML", extensions: ["html"] }],
      csv: [{ name: "CSV", extensions: ["csv"] }],
      xlsx: [{ name: "Excel", extensions: ["xlsx"] }],
    };
    const path = await saveDialog({ defaultPath, filters: filterMap[format] });
    if (!path) return;

    setExporting(true);
    setResult("");
    setError("");
    try {
      if (format === "xlsx") {
        const spellPayload = JSON.stringify(
          spellErrors.map((fw) => ({
            word: fw.word,
            count: fw.count,
            segment_ids: fw.segment_ids,
          }))
        );
        const violPayload = JSON.stringify(violations);
        await invoke("sc_save_report_xlsx", {
          filePath,
          outputPath: path,
          spellErrors: spellPayload,
          violations: violPayload,
        });
      } else {
        const content =
          format === "html"
            ? buildHtmlReport(filePath, spellErrors, violations)
            : buildCsvReport(filePath, spellErrors, violations);
        await invoke("sc_save_report", { path, content });
      }
      setResult(`Exported to ${path.split("/").pop()}`);
      setTimeout(() => setResult(""), 4000);
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button
        className="btn btn-secondary btn-sm"
        onClick={() => exportReport("csv")}
        disabled={exporting}
        aria-busy={exporting}
        aria-label="Export QA report as CSV"
        title="Export as CSV"
      >
        CSV
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
      <button
        className="btn btn-secondary btn-sm"
        onClick={() => exportReport("xlsx")}
        disabled={exporting}
        aria-busy={exporting}
        aria-label="Export QA report as Excel spreadsheet"
        title="Export as Excel (.xlsx)"
      >
        {exporting ? "Exporting…" : "Excel"}
      </button>
      {result && (
        <span style={{ fontSize: 12, color: "var(--success)" }} role="status">
          {result}
        </span>
      )}
      {error && (
        <span style={{ fontSize: 12, color: "var(--danger)" }} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
