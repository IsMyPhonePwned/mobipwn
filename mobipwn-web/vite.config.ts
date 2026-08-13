import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { mobipwnDevLogsPlugin } from "./vite-dev-logs";
import { rustyMagpieBinaryPlugin } from "./vite-rusty-magpie";

const repoRoot = path.resolve(__dirname, "..");
const devLogDir = process.env.MOBIPWN_DEV_DIR
  ? path.resolve(repoRoot, process.env.MOBIPWN_DEV_DIR)
  : path.join(repoRoot, ".dev");
const webPort = Number(process.env.MOBIPWN_WEB_PORT ?? 5173);
const apiPort = webPort + 1;

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    mobipwnDevLogsPlugin(devLogDir),
    rustyMagpieBinaryPlugin(path.resolve(__dirname, "public")),
  ],
  define: {
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "development"),
    "process.env.DRAGGABLE_DEBUG": '""',
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: webPort,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL ?? `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
        // Large bugreport uploads can take several minutes
        timeout: 600_000,
        proxyTimeout: 600_000,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1024,
    rollupOptions: {
      output: {
        manualChunks: {
          codemirror: [
            "@codemirror/view",
            "@codemirror/state",
            "@codemirror/language",
            "@codemirror/commands",
          ],
          search: ["./src/pages/SearchPage.tsx"],
        },
      },
    },
  },
});
