import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";
import { AuthGate } from "./ui/auth/AuthGate";
import "./ui/styles.css";
import { applyTheme, getTheme } from "./ui/theme";

applyTheme(getTheme());

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthGate>{(u) => <App {...u} />}</AuthGate>
  </React.StrictMode>,
);
