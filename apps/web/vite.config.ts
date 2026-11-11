import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The API is proxied under /api so the session cookie stays same-origin.
export default defineConfig({
  plugins: [react()],
  define: { global: "globalThis" },
  server: {
    port: 5173,
    proxy: { "/api": { target: process.env.VEYRA_API_URL ?? "http://localhost:8787", changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") } },
  },
});
