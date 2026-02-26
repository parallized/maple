import { addCollection } from "@iconify/react";
import mingcute from "@iconify-json/mingcute/icons.json";

let loaded = false;

export function ensureIconifyCollectionsLoaded() {
  if (loaded) return;
  loaded = true;
  addCollection(mingcute as any);
}
