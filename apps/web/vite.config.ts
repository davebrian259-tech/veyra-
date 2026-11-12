import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The API is proxied under /api so the session cookie stays same-origin.
export default defineConfig({
  plugins: [react()],
  define: { global: "globalThis" },
  build: {
    target: "es2022",
    rolldownOptions: {
      output: {
        // The wallet selector is large and only needed in live mode; keep it out of the main chunk.
        manualChunks(id: string) {
          if (id.includes("@near-wallet-selector") || id.includes("near-api-js") || id.includes("@near-js")) return "wallet";
          if (id.includes("node_modules/react")) return "react";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": { target: process.env.VEYRA_API_URL ?? "http://localhost:8787", changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") } },
  },
  preview: {
    port: 4173,
    proxy: { "/api": { target: process.env.VEYRA_API_URL ?? "http://localhost:8787", changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") } },
  },
});
