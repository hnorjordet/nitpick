import { useState } from "react";
import App from "./App";
import SpellcheckPanel from "./components/spellcheck/SpellcheckPanel";
import "./spellcheck.css";

type Panel = "regex" | "spellcheck";

export default function AppShell() {
  const [activePanel, setActivePanel] = useState<Panel>("regex");
  const [sharedFilePath, setSharedFilePath] = useState("");

  function handleFileLoaded(path: string) {
    setSharedFilePath(path);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Panel switcher */}
      <div className="panel-switcher">
        <button
          className={`panel-btn${activePanel === "regex" ? " active" : ""}`}
          onClick={() => setActivePanel("regex")}
        >
          RegEx
        </button>
        <button
          className={`panel-btn${activePanel === "spellcheck" ? " active" : ""}`}
          onClick={() => setActivePanel("spellcheck")}
        >
          Spellcheck &amp; QA
        </button>
      </div>

      {/* Both panels always mounted, toggled via display */}
      <div style={{ flex: 1, overflow: "hidden", display: activePanel === "regex" ? "flex" : "none", flexDirection: "column" }}>
        <App onFileLoaded={handleFileLoaded} externalFilePath={sharedFilePath} />
      </div>
      <div style={{ flex: 1, overflow: "hidden", display: activePanel === "spellcheck" ? "flex" : "none", flexDirection: "column" }}>
        <SpellcheckPanel filePath={sharedFilePath} onFileLoaded={handleFileLoaded} />
      </div>
    </div>
  );
}
