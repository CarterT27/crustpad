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
          runnerWorkerHeader("c"),
          runnerWorkerHeader("cpp", "connect-src 'self' https://cdn.jsdelivr.net"),
          runnerWorkerHeader("js"),
          runnerWorkerHeader("ts"),
        ].join("\n"),
      );
    },
  };
}

function runnerWorkerHeader(
  workerName: string,
  connectSrc = "connect-src 'self'",
): string {
  return [
    `/assets/${workerName}.worker-*.js`,
    `  content-security-policy: default-src 'none'; script-src 'self' blob: 'wasm-unsafe-eval'; ${connectSrc}; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`,
    "",
  ].join("\n");
}
