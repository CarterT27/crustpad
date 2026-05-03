import { initialize, transform } from "esbuild-wasm/lib/browser";
import wasmUrl from "esbuild-wasm/esbuild.wasm?url";
import type { WorkerInput } from "./types";
import { executeJavaScript, formatValue, post } from "./workerUtils";

let esbuildReady: Promise<void> | undefined;

(globalThis as unknown as { onmessage: (event: MessageEvent<WorkerInput>) => void })
  .onmessage = (event) => {
    void runTypeScript(event.data);
  };

async function runTypeScript(input: WorkerInput): Promise<void> {
  const start = performance.now();

  try {
    esbuildReady ??= initialize({ wasmURL: wasmUrl, worker: false });
    await esbuildReady;

    const result = await transform(input.source, {
      charset: "utf8",
      format: "esm",
      loader: "ts",
      logLevel: "silent",
      sourcemap: false,
      target: "es2022",
    });

    await executeJavaScript(result.code, input.outputLimit, "crustpad-runner.ts");
  } catch (error) {
    post({
      type: "error",
      error: formatValue(error),
      durationMs: performance.now() - start,
    });
  }
}
