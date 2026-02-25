import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const workspaceAliases = {
  "@maple/kanban-core": fileURLToPath(new URL("../../packages/kanban-core/src/index.ts", import.meta.url)),
  "@maple/agent-runtime": fileURLToPath(new URL("../../packages/agent-runtime/src/index.ts", import.meta.url)),
  "@maple/worker-skills": fileURLToPath(new URL("../../packages/worker-skills/src/index.ts", import.meta.url))
};

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: { alias: workspaceAliases },
  server: {
    port: 1420,
    strictPort: true
  },
  clearScreen: false
});
