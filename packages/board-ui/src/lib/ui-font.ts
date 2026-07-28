import chillRoundTtfUrl from "@fontpkg/chill-round-f/ChillRoundF.ttf?url";
import type { UiFont } from "./constants";

let chillRoundInjected = false;

/** 懒注入寒蝉全圆体 @font-face:仅用户选择后注册,字体文件按需下载。 */
function ensureChillRoundFontFace() {
  if (chillRoundInjected || typeof document === "undefined") return;
  chillRoundInjected = true;
  const style = document.createElement("style");
  style.dataset.mapleFont = "chill-round";
  style.textContent = `@font-face{font-family:"ChillRoundF";src:url("${chillRoundTtfUrl}") format("truetype");font-display:swap;}`;
  document.head.appendChild(style);
}

export function applyUiFont(font: UiFont) {
  const root = document.documentElement;
  root.classList.remove("font-chillround");
  if (font === "chill-round") {
    ensureChillRoundFontFace();
    root.classList.add("font-chillround");
  }
}
