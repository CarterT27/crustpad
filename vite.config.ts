import react from "@vitejs/plugin-react";
import { writeFileSync } from "node:fs";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), cloudflareHeaders()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        ws: true,
      },
    },
  },
});

function cloudflareHeaders() {
  return {
    name: "cloudflare-headers",
    closeBundle() {
      writeFileSync(
        "dist/_headers",
        [
          "/assets/js.worker-*.js",
          "  content-security-policy: default-src 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
          "",
          "/assets/ts.worker-*.js",
          "  content-security-policy: default-src 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
          "",
        ].join("\n"),
      );
    },
  };
}
