import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { localApiPlugin } from "./scripts/local-api.mjs";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return ({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    // The project lives in a parent path that Windows protects from esbuild's
    // directory traversal. Native ESM serving is reliable for this local MVP.
    noDiscovery: true,
    include: [],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react(), localApiPlugin(process.cwd(), {
    provider: env.MODEL_PROVIDER || env.MEDICAL_MODEL_PROVIDER || "deepseek",
    apiKey: env.MODEL_API_KEY || env.DEEPSEEK_API_KEY,
    model: env.MODEL_NAME || env.DEEPSEEK_MODEL || "deepseek-chat",
    baseUrl: env.MODEL_API_URL || env.DEEPSEEK_API_URL || "https://api.deepseek.com",
    timeoutMs: env.MODEL_TIMEOUT_MS || 90000,
  })],
  });
});
