import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Settings, FileEntry, ResultsDisplayMode, DEFAULT_QA_CHECKS } from "./SpellcheckPanel";

interface DicInfo {
  name: string;
  path: string;
  aff_path: string;
  word_count: number;
}

interface Props {
  settings: Settings;
  onSettingsChange: (s: Settings) => void;
}

export default function SettingsPage({ settings, onSettingsChange }: Props) {
  const [dics, setDics] = useState<DicInfo[]>([]);
  const [loadingDics, setLoadingDics] = useState(false);

  function update(partial: Partial<Settings>) {
    onSettingsChange({ ...settings, ...partial });
  }

  // Load dics when the folder changes, and also on first mount if folder is already set
  const [lastLoadedFolder, setLastLoadedFolder] = useState<string>("");

  useEffect(() => {
    if (settings.dic_folder && settings.dic_folder !== lastLoadedFolder) {
      setLastLoadedFolder(settings.dic_folder);
      loadDics(settings.dic_folder);
    }
  });

  async function loadDics(folder: string) {
    setLoadingDics(true);
    try {
      const result = await invoke<DicInfo[]>("sc_list_dics", { folder });
      setDics(result);
    } catch (e) {
      console.error("Failed to list dics:", e);
      setDics([]);
    } finally {
      setLoadingDics(false);
    }
  }

  async function chooseDicFolder() {
    const selected = await openDialog({ directory: true, multiple: false });
    if (selected && typeof selected === "string") {
      update({ dic_folder: selected, selected_dics: [] });
      loadDics(selected);
    }
  }

  function toggleDic(dicPath: string, checked: boolean) {
    const next = checked
      ? [...settings.selected_dics, dicPath]
      : settings.selected_dics.filter((d) => d !== dicPath);
    update({ selected_dics: next });
  }

  async function addTermlist() {
    const selected = await openDialog({
      multiple: true,
      filters: [{ name: "Termlists", extensions: ["csv", "tbx"] }],
    });
    const paths: string[] = Array.isArray(selected)
      ? selected
      : selected
      ? [selected as string]
      : [];
    if (paths.length === 0) return;
    const existing = settings.termlists.map((t) => t.path);
    const newEntries: FileEntry[] = paths
      .filter((p) => !existing.includes(p))
      .map((p) => ({ path: p, enabled: true }));
    update({ termlists: [...settings.termlists, ...newEntries] });
  }

  function removeTermlist(path: string) {
    update({ termlists: settings.termlists.filter((t) => t.path !== path) });
  }

  function toggleTermlist(path: string, enabled: boolean) {
    update({
      termlists: settings.termlists.map((t) =>
        t.path === path ? { ...t, enabled } : t
      ),
    });
  }

  async function addChecklist() {
    const selected = await openDialog({
      multiple: true,
      filters: [{ name: "Checklists", extensions: ["xbench", "xbckl", "xml"] }],
    });
    const paths: string[] = Array.isArray(selected)
      ? selected
      : selected
      ? [selected as string]
      : [];
    if (paths.length === 0) return;
    const existing = settings.checklists.map((c) => c.path);
    const newEntries: FileEntry[] = paths
      .filter((p) => !existing.includes(p))
      .map((p) => ({ path: p, enabled: true }));
    update({ checklists: [...settings.checklists, ...newEntries] });
  }

  function removeChecklist(path: string) {
    update({ checklists: settings.checklists.filter((c) => c.path !== path) });
  }

  function toggleChecklist(path: string, enabled: boolean) {
    update({
      checklists: settings.checklists.map((c) =>
        c.path === path ? { ...c, enabled } : c
      ),
    });
  }

  return (
    <div className="settings-page">

      {/* ── Dictionaries ─────────────────────────────────────────────── */}
      <section className="settings-section" aria-labelledby="sec-dics">
        <h2 id="sec-dics" className="settings-section-title">
          Dictionaries
        </h2>

        <div className="settings-row">
          <div style={{ flex: 1 }}>
            <label htmlFor="dic-folder-input">
              Dictionary folder (.dic / .aff files)
            </label>
            <input
              id="dic-folder-input"
              type="text"
              value={settings.dic_folder}
              readOnly
              aria-readonly="true"
              aria-label="Selected dictionary folder path (read-only)"
              placeholder="No folder selected"
            />
          </div>
          <button
            className="btn btn-secondary"
            style={{ marginTop: 18, flexShrink: 0 }}
            onClick={chooseDicFolder}
            aria-label="Browse for dictionary folder"
          >
            Browse…
          </button>
        </div>

        {loadingDics && (
          <div className="settings-loading" role="status" aria-live="polite">
            <span className="spinner" aria-hidden="true" />
            <span className="sr-only">Loading dictionaries…</span>
          </div>
        )}

        {dics.length > 0 && (
          <div>
            <div className="dic-list-header">
              <label id="select-dics-label">
                Select dictionaries to use (multiple selections are combined):
              </label>
              {dics.length > 1 && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => update({ selected_dics: dics.map((d) => d.path) })}
                  aria-label="Select all dictionaries"
                >
                  Select all
                </button>
              )}
            </div>
            <div
              className="dic-list-box"
              role="group"
              aria-labelledby="select-dics-label"
            >
              {dics.map((d) => (
                <label key={d.path} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={settings.selected_dics.includes(d.path)}
                    onChange={(e) => toggleDic(d.path, e.target.checked)}
                    aria-label={`${d.name} — ${d.word_count.toLocaleString()} words`}
                  />
                  <span style={{ flex: 1 }}>{d.name}</span>
                  <span className="dic-word-count" aria-hidden="true">
                    {d.word_count.toLocaleString()} words
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {dics.length === 0 && settings.dic_folder && !loadingDics && (
          <p className="settings-hint" style={{ marginTop: 8 }}>
            No .dic / .aff pairs found in the selected folder.
          </p>
        )}
      </section>

      {/* ── Backup ───────────────────────────────────────────────────── */}
      <section className="settings-section" aria-labelledby="sec-backup">
        <h2 id="sec-backup" className="settings-section-title">
          Backup
        </h2>
        <label className="checkbox-row" htmlFor="backup-xliff">
          <input
            id="backup-xliff"
            type="checkbox"
            checked={settings.backup_enabled}
            onChange={(e) => update({ backup_enabled: e.target.checked })}
          />
          <span>Create .bak backup before saving XLIFF edits</span>
        </label>
        <label className="checkbox-row" htmlFor="backup-dic" style={{ marginTop: 4 }}>
          <input
            id="backup-dic"
            type="checkbox"
            checked={settings.backup_enabled}
            onChange={(e) => update({ backup_enabled: e.target.checked })}
          />
          <span>Create timestamped snapshot before editing .dic files</span>
        </label>
        <p className="settings-note">
          Snapshots are saved as{" "}
          <code style={{ fontSize: 11 }}>
            filename.dic-pic_YYYY-MM-DD_HH-MM-SS
          </code>{" "}
          in the same folder.
        </p>
      </section>

      {/* ── Termlists ────────────────────────────────────────────────── */}
      <section className="settings-section" aria-labelledby="sec-termlists">
        <h2 id="sec-termlists" className="settings-section-title">
          Termlists
        </h2>
        <p className="settings-hint">
          CSV (source, target) or TBX files. Enabled termlists are used for both
          spellcheck exclusion and the terminology check.
        </p>
        <ul
          className="file-list"
          style={{ marginBottom: 10 }}
          role="list"
          aria-label="Added termlists"
        >
          {settings.termlists.length === 0 && (
            <li className="settings-hint" style={{ listStyle: "none" }}>
              No termlists added.
            </li>
          )}
          {settings.termlists.map((t) => {
            const name = t.path.split("/").pop() ?? t.path;
            return (
              <li key={t.path} className="file-list-item">
                <input
                  type="checkbox"
                  id={`termlist-${t.path}`}
                  checked={t.enabled}
                  onChange={(e) => toggleTermlist(t.path, e.target.checked)}
                  aria-label={`Enable termlist ${name}`}
                  style={{ flexShrink: 0 }}
                />
                <label
                  htmlFor={`termlist-${t.path}`}
                  className="file-name"
                  title={t.path}
                  style={{ margin: 0, color: "var(--text)", cursor: "pointer" }}
                >
                  {name}
                </label>
                <button
                  className="remove-btn"
                  onClick={() => removeTermlist(t.path)}
                  aria-label={`Remove termlist ${name}`}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
        <button className="btn btn-secondary btn-sm" onClick={addTermlist}>
          + Add termlist…
        </button>
      </section>

      {/* ── Checklists ───────────────────────────────────────────────── */}
      <section className="settings-section" aria-labelledby="sec-checklists">
        <h2 id="sec-checklists" className="settings-section-title">
          Checklists
        </h2>
        <p className="settings-hint">
          Xbench XML checklist files (.xbench / .xbckl / .xml).
        </p>
        <ul
          className="file-list"
          style={{ marginBottom: 10 }}
          role="list"
          aria-label="Added checklists"
        >
          {settings.checklists.length === 0 && (
            <li className="settings-hint" style={{ listStyle: "none" }}>
              No checklists added.
            </li>
          )}
          {settings.checklists.map((c) => {
            const name = c.path.split("/").pop() ?? c.path;
            return (
              <li key={c.path} className="file-list-item">
                <input
                  type="checkbox"
                  id={`checklist-${c.path}`}
                  checked={c.enabled}
                  onChange={(e) => toggleChecklist(c.path, e.target.checked)}
                  aria-label={`Enable checklist ${name}`}
                  style={{ flexShrink: 0 }}
                />
                <label
                  htmlFor={`checklist-${c.path}`}
                  className="file-name"
                  title={c.path}
                  style={{ margin: 0, color: "var(--text)", cursor: "pointer" }}
                >
                  {name}
                </label>
                <button
                  className="remove-btn"
                  onClick={() => removeChecklist(c.path)}
                  aria-label={`Remove checklist ${name}`}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
        <button className="btn btn-secondary btn-sm" onClick={addChecklist}>
          + Add checklist…
        </button>
      </section>

      {/* ── Language matching ─────────────────────────────────────────── */}
      <section className="settings-section" aria-labelledby="sec-lang">
        <h2 id="sec-lang" className="settings-section-title">
          Language matching
        </h2>
        <label className="checkbox-row" htmlFor="strict-lang">
          <input
            id="strict-lang"
            type="checkbox"
            checked={settings.strict_lang_match}
            onChange={(e) => update({ strict_lang_match: e.target.checked })}
          />
          <span>
            Require dictionary language code to match XLIFF target language
          </span>
        </label>
        <p className="warning-text settings-note" role="note">
          Warning: XLIFF language codes vary by CAT tool (nb-NO, nb_NO, no, nor…) and may not
          match .dic filenames directly. Off by default.
        </p>
      </section>

      {/* ── Spellcheck options ────────────────────────────────────────── */}
      <section className="settings-section" aria-labelledby="sec-spellcheck-opts">
        <h2 id="sec-spellcheck-opts" className="settings-section-title">
          Spellcheck options
        </h2>
        <label className="checkbox-row" htmlFor="skip-locked">
          <input
            id="skip-locked"
            type="checkbox"
            checked={settings.skip_locked ?? true}
            onChange={(e) => update({ skip_locked: e.target.checked })}
          />
          <span>Skip locked / read-only segments</span>
        </label>
        <p className="settings-note">
          Segments marked as locked in Phrase, memoQ, or Trados are excluded from spellcheck.
        </p>
        <label className="checkbox-row" htmlFor="skip-100-match">
          <input
            id="skip-100-match"
            type="checkbox"
            checked={settings.skip_100_match ?? true}
            onChange={(e) => update({ skip_100_match: e.target.checked })}
          />
          <span>Skip 100% TM matches</span>
        </label>
        <p className="settings-note">
          Segments with a 100% translation memory match are excluded from all checks.
        </p>
        <label className="checkbox-row" htmlFor="compound-check">
          <input
            id="compound-check"
            type="checkbox"
            checked={settings.compound_check ?? true}
            onChange={(e) => update({ compound_check: e.target.checked })}
          />
          <span>Accept compound words (Norwegian heuristic)</span>
        </label>
        <p className="settings-note">
          Words whose parts are all valid dictionary words are accepted (e.g. <em>barnehageplass</em>).
          Reduces false positives for compound-rich languages. Disable if you see too many missed errors.
        </p>
      </section>

      {/* ── Watch folder ─────────────────────────────────────────────── */}
      <section className="settings-section" aria-labelledby="sec-watch">
        <h2 id="sec-watch" className="settings-section-title">
          Watch folder
        </h2>
        <p className="settings-hint">
          Automatically open new XLIFF files dropped into a folder — e.g. your memoQ or Phrase export folder.
        </p>
        <label className="checkbox-row" htmlFor="watch-enabled">
          <input
            id="watch-enabled"
            type="checkbox"
            checked={settings.watch_folder_enabled ?? false}
            onChange={(e) => update({ watch_folder_enabled: e.target.checked })}
          />
          <span>Enable watch folder</span>
        </label>

        {settings.watch_folder_enabled && (
          <div className="settings-row" style={{ marginTop: 10 }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="watch-folder-input">Folder to watch</label>
              <input
                id="watch-folder-input"
                type="text"
                value={settings.watch_folder ?? ""}
                readOnly
                aria-readonly="true"
                placeholder="No folder selected"
              />
            </div>
            <button
              className="btn btn-secondary"
              style={{ marginTop: 18, flexShrink: 0 }}
              onClick={async () => {
                const selected = await openDialog({ directory: true, multiple: false });
                if (selected && typeof selected === "string") {
                  update({ watch_folder: selected });
                }
              }}
              aria-label="Browse for watch folder"
            >
              Browse…
            </button>
          </div>
        )}

        {settings.watch_folder_enabled && settings.watch_folder && (
          <p className="settings-watch-active">
            Watching: <strong>{settings.watch_folder}</strong>
          </p>
        )}
      </section>

      {/* ── QA Checks ────────────────────────────────────────────── */}
      <section className="settings-section" aria-labelledby="sec-qa-checks">
        <h2 id="sec-qa-checks" className="settings-section-title">
          QA checks
        </h2>
        <p className="settings-hint">
          Toggle individual checks included in "Run all checks".
          These run alongside spellcheck, terminology, and number/formatting checks.
        </p>
        <div className="settings-btn-row">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => update({ qa_checks: { ...DEFAULT_QA_CHECKS } })}
          >
            Select all
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() =>
              update({
                qa_checks: Object.fromEntries(
                  Object.keys(settings.qa_checks ?? DEFAULT_QA_CHECKS).map((k) => [k, false])
                ),
              })
            }
          >
            Deselect all
          </button>
        </div>

        {/* Group 1: Translation completeness */}
        <fieldset className="qa-fieldset">
          <legend className="qa-group-legend">Translation completeness</legend>
          {([
            ["untranslated", "Untranslated segments"],
            ["source_equals_target", "Source = Target (target identical to source)"],
            ["inconsistent_source", "Inconsistent translations (same source, different targets)"],
            ["inconsistent_target", "Inconsistent translations (same target, different sources)"],
          ] as [string, string][]).map(([id, label]) => (
            <label key={id} className="checkbox-row">
              <input
                type="checkbox"
                checked={(settings.qa_checks ?? DEFAULT_QA_CHECKS)[id] ?? true}
                onChange={(e) =>
                  update({
                    qa_checks: { ...(settings.qa_checks ?? DEFAULT_QA_CHECKS), [id]: e.target.checked },
                  })
                }
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>

        {/* Group 2: Formatting & symbols */}
        <fieldset className="qa-fieldset">
          <legend className="qa-group-legend">Formatting &amp; symbols</legend>
          {([
            ["tag_mismatch", "Tag mismatches (inline tags differ between source and target)"],
            ["double_blanks", "Double blanks (consecutive spaces in target)"],
            ["repeated_words", "Repeated words (consecutive duplicate words in target)"],
          ] as [string, string][]).map(([id, label]) => (
            <label key={id} className="checkbox-row">
              <input
                type="checkbox"
                checked={(settings.qa_checks ?? DEFAULT_QA_CHECKS)[id] ?? true}
                onChange={(e) =>
                  update({
                    qa_checks: { ...(settings.qa_checks ?? DEFAULT_QA_CHECKS), [id]: e.target.checked },
                  })
                }
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>

        {/* Group 3: Punctuation */}
        <fieldset className="qa-fieldset">
          <legend className="qa-group-legend">Punctuation</legend>
          {([
            ["punctuation_mismatch", "Trailing punctuation mismatch (e.g. source ends with '?', target with '.')"],
            ["double_punctuation", "Double punctuation in target (e.g. '..', ',,', '!!')"],
            ["quotation_mark_style", 'Straight ASCII quotes in target (use typographic quotes instead, e.g. «»)'],
          ] as [string, string][]).map(([id, label]) => (
            <label key={id} className="checkbox-row">
              <input
                type="checkbox"
                checked={(settings.qa_checks ?? DEFAULT_QA_CHECKS)[id] ?? false}
                onChange={(e) =>
                  update({
                    qa_checks: { ...(settings.qa_checks ?? DEFAULT_QA_CHECKS), [id]: e.target.checked },
                  })
                }
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>

        {/* Group 4: Content matching */}
        <fieldset className="qa-fieldset">
          <legend className="qa-group-legend">Content matching</legend>
          {([
            ["url_email_mismatch", "URL/Email mismatches"],
            ["alphanumeric_mismatch", "Alphanumeric token mismatches (e.g. ABC123)"],
            ["uppercase_mismatch", "UPPERCASE word mismatches"],
            ["camelcase_mismatch", "CamelCase word mismatches (e.g. ArcMap, GeoJSON)"],
          ] as [string, string][]).map(([id, label]) => (
            <label key={id} className="checkbox-row">
              <input
                type="checkbox"
                checked={(settings.qa_checks ?? DEFAULT_QA_CHECKS)[id] ?? true}
                onChange={(e) =>
                  update({
                    qa_checks: { ...(settings.qa_checks ?? DEFAULT_QA_CHECKS), [id]: e.target.checked },
                  })
                }
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>

        {/* Group 5: Segment length */}
        <fieldset className="qa-fieldset">
          <legend className="qa-group-legend">Segment length</legend>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={(settings.qa_checks ?? DEFAULT_QA_CHECKS)["segment_length_ratio"] ?? false}
              onChange={(e) =>
                update({
                  qa_checks: { ...(settings.qa_checks ?? DEFAULT_QA_CHECKS), segment_length_ratio: e.target.checked },
                })
              }
            />
            <span>
              Segment length ratio — flag target that is &lt;25% or &gt;300% of source length
              <span className="settings-note" style={{ display: "block", marginTop: 2 }}>
                Useful for software UI strings where character limits matter. Off by default.
              </span>
            </span>
          </label>
        </fieldset>
      </section>

      {/* ── Results display mode ───────────────────────────────────── */}
      <section className="settings-section" aria-labelledby="sec-display-mode">
        <h2 id="sec-display-mode" className="settings-section-title">
          Combined results display
        </h2>
        <p className="settings-hint">
          How spelling and terminology results are shown in the sidebar when using "Run all checks".
        </p>
        <fieldset
          role="radiogroup"
          aria-label="Results display mode"
          style={{ border: "none", padding: 0, margin: 0 }}
        >
          {([
            { value: 1 as ResultsDisplayMode, label: "Flat list", desc: "All items in one list, colour and icon per type" },
            { value: 2 as ResultsDisplayMode, label: "Two sections", desc: "SPELLING header, then TERMINOLOGY header" },
            { value: 3 as ResultsDisplayMode, label: "Two tabs", desc: "Spelling tab and Terminology tab" },
          ] as const).map((opt) => (
            <label key={opt.value} className="radio-option">
              <input
                type="radio"
                name="results_display_mode"
                checked={(settings.results_display_mode ?? 1) === opt.value}
                onChange={() => update({ results_display_mode: opt.value })}
                aria-label={`${opt.label}: ${opt.desc}`}
              />
              <span>
                <span className="radio-option-label">{opt.label}</span>
                <span className="radio-option-desc">{opt.desc}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </section>
    </div>
  );
}
