import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/maple-mono/400.css";
import "@fontsource/maple-mono/500.css";
import "@fontsource/maple-mono/600.css";
import "@fontsource/maple-mono/700.css";
import "font-smiley-sans/style.css";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
