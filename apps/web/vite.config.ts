import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        "/api": env.MAPLE_SERVER_PROXY || "http://127.0.0.1:45820",
        "/health": env.MAPLE_SERVER_PROXY || "http://127.0.0.1:45820"
      }
    }
  };
});
