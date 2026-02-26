import { addCollection } from "@iconify/react";
import mingcute from "@iconify-json/mingcute/icons.json";
import type { IconifyJSON } from "@iconify/types";

let loaded = false;

export function ensureIconifyCollectionsLoaded() {
  if (loaded) return;
  loaded = true;
  addCollection(mingcute as IconifyJSON);
}
