import { useState, useRef } from "react";
import App from "./App";
import SpellcheckPanel from "./components/spellcheck/SpellcheckPanel";
import "./spellcheck.css";

type Panel = "regex" | "spellcheck";
const PANELS: Panel[] = ["regex", "spellcheck"];

export default function AppShell() {
  const [activePanel, setActivePanel] = useState<Panel>("regex");
  const [sharedFilePaths, setSharedFilePaths] = useState<string[]>([]);
  const switcherRef = useRef<HTMLDivElement>(null);

  function handleFileLoaded(paths: string[]) {
    setSharedFilePaths(paths);
    // docx files are only supported in Spellcheck/QA — auto-switch panel
    if (paths.length === 1 && paths[0].toLowerCase().endsWith('.docx')) {
      setActivePanel("spellcheck");
    }
  }

  // Arrow-key navigation between top-level panel tabs (ARIA tablist pattern)
  function handleSwitcherKeyDown(e: React.KeyboardEvent, current: Panel) {
    const idx = PANELS.indexOf(current);
    let next: Panel | null = null;
    if (e.key === "ArrowRight") next = PANELS[(idx + 1) % PANELS.length];
    if (e.key === "ArrowLeft") next = PANELS[(idx - 1 + PANELS.length) % PANELS.length];
    if (e.key === "Home") next = PANELS[0];
    if (e.key === "End") next = PANELS[PANELS.length - 1];
    if (next) {
      e.preventDefault();
      setActivePanel(next);
      switcherRef.current?.querySelector<HTMLElement>(`[data-panel="${next}"]`)?.focus();
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Panel switcher — tablist role for ARIA tab pattern */}
      <div className="panel-switcher" role="tablist" aria-label="Application panels" ref={switcherRef}>
        <button
          role="tab"
          data-panel="regex"
          aria-selected={activePanel === "regex"}
          aria-controls="panel-regex"
          id="tab-regex"
          tabIndex={activePanel === "regex" ? 0 : -1}
          className={`panel-btn${activePanel === "regex" ? " active" : ""}`}
          onClick={() => setActivePanel("regex")}
          onKeyDown={(e) => handleSwitcherKeyDown(e, "regex")}
        >
          Search
        </button>
        <button
          role="tab"
          data-panel="spellcheck"
          aria-selected={activePanel === "spellcheck"}
          aria-controls="panel-spellcheck"
          id="tab-spellcheck"
          tabIndex={activePanel === "spellcheck" ? 0 : -1}
          className={`panel-btn${activePanel === "spellcheck" ? " active" : ""}`}
          onClick={() => setActivePanel("spellcheck")}
          onKeyDown={(e) => handleSwitcherKeyDown(e, "spellcheck")}
        >
          Spellcheck / QA
        </button>
      </div>

      {/* Both panels always mounted — inert hides inactive panel from keyboard/AT */}
      <div
        id="panel-regex"
        role="tabpanel"
        aria-labelledby="tab-regex"
        style={{ flex: 1, overflow: "hidden", display: activePanel === "regex" ? "flex" : "none", flexDirection: "column" }}
        inert={activePanel !== "regex" || undefined}
      >
        <App onFileLoaded={handleFileLoaded} externalFilePath={sharedFilePaths.length === 1 ? sharedFilePaths[0] : ""} />
      </div>
      <div
        id="panel-spellcheck"
        role="tabpanel"
        aria-labelledby="tab-spellcheck"
        style={{ flex: 1, overflow: "hidden", display: activePanel === "spellcheck" ? "flex" : "none", flexDirection: "column" }}
        inert={activePanel !== "spellcheck" || undefined}
      >
        <SpellcheckPanel filePaths={sharedFilePaths} onFileLoaded={handleFileLoaded} />
      </div>
    </div>
  );
}
