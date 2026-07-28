import { addCollection } from "@iconify/react";
import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource/maple-mono/400.css";
import "@fontsource/maple-mono/500.css";
import "@fontsource/maple-mono/600.css";
import "@fontsource/maple-mono/700.css";
import "font-smiley-sans/style.css";
import "@maple/board-ui/styles.css";
import "@maple/board-ui/radius-overrides.css";
import "@maple/board-ui/badge-overrides.css";
import { App } from "./App";
import mingcuteIcons from "./generated/mingcute.json";
import logosIcons from "./generated/logos.json";

addCollection(mingcuteIcons);
addCollection(logosIcons);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
