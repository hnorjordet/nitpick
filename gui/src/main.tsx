import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/tokens.css";
import "./styles/components.css";
import AppShell from "./AppShell";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>,
);
