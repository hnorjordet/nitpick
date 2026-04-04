import { useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Settings } from "./SpellcheckPanel";

export interface FlaggedWord {
  word: string;
  count: number;
  segment_ids: string[];
}

interface SegmentContext {
  id: string;
  source: string;
  target: string;
}

interface Props {
  flaggedWords: FlaggedWord[];
  filePath: string;
  settings: Settings;
  onDone: (realErrors: FlaggedWord[]) => void;
}

type WordDecision = "pending" | "real" | "false_positive" | "added_to_dic" | "ignored_once" | "ignored_in_doc";

/**
 * Highlights occurrences of `word` in `text`.
 * Uses <mark> (semantically correct for highlighted/relevant text, WCAG 1.3.1).
 * A visually-hidden label inside <mark> announces the context to screen readers.
 */
function highlight(text: string, word: string): React.ReactNode {
  if (!word) return text;
  const re = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(re);
  return parts.map((part, i) =>
    re.test(part) ? (
      <mark
        key={i}
        className="highlight-word"
        // Screen readers announce <mark> content as normal text; the surrounding
        // sentence provides context. No extra aria-label needed here.
      >
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export default function TriageWindow({ flaggedWords, filePath, settings, onDone }: Props) {
  const [decisions, setDecisions] = useState<Record<string, WordDecision>>(() => {
    const init: Record<string, WordDecision> = {};
    flaggedWords.forEach((fw) => (init[fw.word] = "false_positive"));
    return init;
  });
  const [addStatus, setAddStatus] = useState<Record<string, string>>({});
  const [dicTarget, setDicTarget] = useState<string>(settings.selected_dics[0] || "");
  const [selectedWord, setSelectedWord] = useState<FlaggedWord | null>(
    flaggedWords.length > 0 ? flaggedWords[0] : null
  );
  const [contexts, setContexts] = useState<SegmentContext[]>([]);
  const [contextsLoading, setContextsLoading] = useState(false);

  // Ref to track the last selected word for aria-live announcement
  const announcerRef = useRef<HTMLDivElement>(null);

  // Draggable splitter
  const [leftWidth, setLeftWidth] = useState(520);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  const onSplitterMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartWidth.current = leftWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = ev.clientX - dragStartX.current;
      const newW = Math.max(280, Math.min(800, dragStartWidth.current + delta));
      setLeftWidth(newW);
    };
    const onMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [leftWidth]);

  function decide(word: string, decision: WordDecision) {
    setDecisions((prev) => ({ ...prev, [word]: decision }));
  }

  async function selectWord(fw: FlaggedWord) {
    setSelectedWord(fw);
    setContextsLoading(true);
    try {
      const result = await invoke<{ segments: SegmentContext[] }>("sc_get_segments_for_word", {
        filePath,
        word: fw.word,
        dics: settings.selected_dics,
      });
      setContexts(result.segments);
    } catch {
      setContexts([]);
    } finally {
      setContextsLoading(false);
    }
  }

  async function addToDic(fw: FlaggedWord) {
    const dic = dicTarget || settings.selected_dics[0];
    if (!dic) {
      setAddStatus((prev) => ({ ...prev, [fw.word]: "No dictionary selected" }));
      return;
    }
    try {
      const result = await invoke<{ word_count: number; word: string }>("sc_add_to_dic", {
        word: fw.word,
        dicPath: dic,
        backup: settings.backup_enabled,
      });
      setAddStatus((prev) => ({
        ...prev,
        [fw.word]: `Added (${result.word_count} words in dic)`,
      }));
      decide(fw.word, "added_to_dic");
    } catch (e) {
      setAddStatus((prev) => ({
        ...prev,
        [fw.word]: `Error: ${e}`,
      }));
    }
  }

  function handleDone() {
    const realErrors = flaggedWords.filter((fw) => decisions[fw.word] === "real");
    onDone(realErrors);
  }

  const realCount = Object.values(decisions).filter((d) => d === "real").length;
  const dismissedCount = Object.values(decisions).filter(
    (d) => d === "false_positive" || d === "added_to_dic" || d === "ignored_once" || d === "ignored_in_doc"
  ).length;

  // Keyboard handler for table rows
  function handleRowKeyDown(e: React.KeyboardEvent, fw: FlaggedWord) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectWord(fw);
    }
  }

  return (
    <div
      style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}
      // aria-label for the overall region
    >
      {/* Visually-hidden live region for status announcements (WCAG 4.1.3) */}
      <div
        ref={announcerRef}
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        role="status"
      />

      {/* Header */}
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
        {/* Summary counts — aria-live so screen readers hear updates */}
        <div aria-live="polite" aria-atomic="true">
          <strong>Triage</strong> — {flaggedWords.length} flagged word
          {flaggedWords.length !== 1 ? "s" : ""}
        </div>
        <span className="badge badge-error" aria-label={`${realCount} real errors`}>
          {realCount} real errors
        </span>
        {dismissedCount > 0 && (
          <span className="badge badge-ok" aria-label={`${dismissedCount} dismissed`}>
            {dismissedCount} dismissed
          </span>
        )}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {settings.selected_dics.length > 1 && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
              <span className="sr-only">Add to dictionary:</span>
              <select
                value={dicTarget}
                onChange={(e) => setDicTarget(e.target.value)}
                aria-label="Select dictionary for 'Add to dic'"
                style={{ width: 220 }}
              >
                {settings.selected_dics.map((d) => (
                  <option key={d} value={d}>
                    {d.split("/").pop()}
                  </option>
                ))}
              </select>
            </label>
          )}
          {realCount === 0 ? (
            <button
              className="btn btn-primary"
              onClick={() => onDone([])}
              aria-label="Done — no real errors found"
            >
              Done — no errors ✓
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={handleDone}
              aria-label={`View results for ${realCount} real error${realCount !== 1 ? "s" : ""}`}
            >
              View results ({realCount}) →
            </button>
          )}
        </div>
      </div>

      {/* Split body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left: word list */}
        <div
          style={{
            width: leftWidth,
            flexShrink: 0,
            overflowY: "auto",
          }}
        >
          <table
            className="data-table"
            role="grid"
            aria-label="Flagged words"
            aria-rowcount={flaggedWords.length}
          >
            <colgroup>
              <col style={{ width: 160 }} />
              <col style={{ width: 52 }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Word</th>
                <th scope="col">Count</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {flaggedWords.map((fw, rowIdx) => {
                const dec = decisions[fw.word];
                const isSelected = selectedWord?.word === fw.word;
                const status = addStatus[fw.word];
                return (
                  <tr
                    key={fw.word}
                    onClick={() => selectWord(fw)}
                    onKeyDown={(e) => handleRowKeyDown(e, fw)}
                    tabIndex={0}
                    role="row"
                    aria-rowindex={rowIdx + 2} /* +2 because header is row 1 */
                    aria-selected={isSelected}
                    aria-label={`${fw.word}, ${fw.count} occurrence${fw.count !== 1 ? "s" : ""}, ${
                      dec === "real"
                        ? "marked as real error"
                        : dec === "added_to_dic"
                        ? "added to dictionary"
                        : dec === "ignored_once"
                        ? "ignored once"
                        : dec === "ignored_in_doc"
                        ? "ignored in document"
                        : "dismissed"
                    }`}
                    style={{
                      cursor: "pointer",
                      opacity: dec === "added_to_dic" ? 0.5 : 1,
                      background: isSelected
                        ? "rgba(10,132,255,0.15)"
                        : dec === "real"
                        ? "rgba(255,69,58,0.1)"
                        : dec === "added_to_dic"
                        ? "rgba(50,215,75,0.08)"
                        : undefined,
                    }}
                  >
                    <td>
                      <span style={{ fontWeight: 600, fontFamily: "monospace" }}>
                        {fw.word}
                      </span>
                      {/* Status feedback for add-to-dic (aria-live via live region above) */}
                      {status && (
                        <div
                          style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}
                          aria-live="polite"
                        >
                          {status}
                        </div>
                      )}
                    </td>
                    <td
                      style={{ textAlign: "right", color: "var(--text-secondary)" }}
                      aria-label={`${fw.count} occurrence${fw.count !== 1 ? "s" : ""}`}
                    >
                      {fw.count}
                    </td>
                    <td>
                      <div
                        style={{ display: "flex", gap: 6 }}
                        // Stop click propagation so action buttons don't also trigger row selection
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <button
                          className={`btn btn-sm ${dec === "real" ? "btn-danger" : "btn-secondary"}`}
                          onClick={() =>
                            decide(fw.word, dec === "real" ? "false_positive" : "real")
                          }
                          disabled={dec === "added_to_dic"}
                          aria-pressed={dec === "real"}
                          aria-label={
                            dec === "real"
                              ? `Undo: un-mark "${fw.word}" as real error`
                              : `Mark "${fw.word}" as real error`
                          }
                        >
                          {dec === "real" ? "Undo" : "Real error"}
                        </button>
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => addToDic(fw)}
                          disabled={dec === "added_to_dic" || dec === "real"}
                          aria-label={`Add "${fw.word}" to ${
                            dicTarget
                              ? dicTarget.split("/").pop()
                              : "dictionary"
                          }`}
                        >
                          Add to dic
                        </button>
                        <button
                          className={`btn btn-sm ${dec === "ignored_once" ? "btn-primary" : "btn-secondary"}`}
                          onClick={() =>
                            decide(fw.word, dec === "ignored_once" ? "false_positive" : "ignored_once")
                          }
                          disabled={dec === "added_to_dic" || dec === "real"}
                          aria-pressed={dec === "ignored_once"}
                          aria-label={
                            dec === "ignored_once"
                              ? `Undo: stop ignoring "${fw.word}" once`
                              : `Ignore "${fw.word}" this time only`
                          }
                        >
                          {dec === "ignored_once" ? "Ignored once" : "Ignore once"}
                        </button>
                        <button
                          className={`btn btn-sm ${dec === "ignored_in_doc" ? "btn-primary" : "btn-secondary"}`}
                          onClick={() =>
                            decide(fw.word, dec === "ignored_in_doc" ? "false_positive" : "ignored_in_doc")
                          }
                          disabled={dec === "added_to_dic" || dec === "real"}
                          aria-pressed={dec === "ignored_in_doc"}
                          aria-label={
                            dec === "ignored_in_doc"
                              ? `Undo: stop ignoring "${fw.word}" in document`
                              : `Ignore "${fw.word}" throughout this document`
                          }
                        >
                          {dec === "ignored_in_doc" ? "Ignored in doc" : "Ignore in doc"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Draggable splitter */}
        <div
          onMouseDown={onSplitterMouseDown}
          style={{
            width: 5,
            flexShrink: 0,
            cursor: "col-resize",
            background: "var(--border)",
            transition: "background 0.1s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "var(--border)")}
          title="Drag to resize"
          aria-hidden="true"
        />

        {/* Right: context panel */}
        <div
          style={{ flex: 1, overflowY: "auto", padding: 16 }}
          role="region"
          aria-label="Word context"
          aria-live="polite"
          aria-busy={contextsLoading}
        >
          {!selectedWord ? (
            <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>
              Select a word in the table to see examples in context.
            </p>
          ) : contextsLoading ? (
            <p style={{ color: "var(--text-secondary)", fontSize: 13 }} aria-live="polite">
              <span className="spinner" aria-hidden="true" style={{ marginRight: 8 }} />
              Loading context…
            </p>
          ) : contexts.length === 0 ? (
            <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>
              No context available for this word.
            </p>
          ) : (
            <>
              <p
                style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 10 }}
                aria-live="polite"
              >
                Showing {contexts.length} of {selectedWord.count} occurrence
                {selectedWord.count !== 1 ? "s" : ""} of{" "}
                <strong style={{ fontFamily: "monospace" }}>{selectedWord.word}</strong>
              </p>
              {contexts.map((ctx) => (
                <article
                  key={ctx.id}
                  aria-label={`Segment ${ctx.id}`}
                  style={{
                    marginBottom: 12,
                    padding: "10px 12px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                >
                  {/* Segment ID */}
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-secondary)",
                      marginBottom: 6,
                      fontFamily: "monospace",
                    }}
                    aria-label={`Segment ID: ${ctx.id}`}
                  >
                    #{ctx.id}
                  </div>
                  <div
                    style={{ color: "var(--text-secondary)", marginBottom: 4, fontSize: 11 }}
                    id={`ctx-src-label-${ctx.id}`}
                  >
                    Source
                  </div>
                  <div
                    style={{ marginBottom: 8, color: "var(--text-secondary)" }}
                    aria-labelledby={`ctx-src-label-${ctx.id}`}
                  >
                    {ctx.source}
                  </div>
                  <div
                    style={{ color: "var(--text-secondary)", marginBottom: 4, fontSize: 11 }}
                    id={`ctx-tgt-label-${ctx.id}`}
                  >
                    Target
                  </div>
                  <div aria-labelledby={`ctx-tgt-label-${ctx.id}`}>
                    {highlight(ctx.target, selectedWord.word)}
                  </div>
                </article>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
