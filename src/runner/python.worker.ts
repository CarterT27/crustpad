import type { WorkerInput } from "./types";
import { formatPythonError } from "./pythonErrors";
import { blockHostApis, createOutputEmitter, formatValue, post } from "./workerUtils";

type PyodideRuntime = {
  runPythonAsync(source: string): Promise<unknown>;
};

type PyodideModule = {
  loadPyodide(options: {
    indexURL: string;
    stdout: (text: string) => void;
    stderr: (text: string) => void;
  }): Promise<PyodideRuntime>;
};

const pyodideBaseUrl = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
const pyodideModuleUrl = `${pyodideBaseUrl}pyodide.mjs`;
let pyodideReady: Promise<PyodideRuntime> | undefined;
let currentEmit:
  | ((stream: "stdout" | "stderr", text: string) => void)
  | undefined;
let hostApisBlocked = false;

(globalThis as unknown as { onmessage: (event: MessageEvent<WorkerInput>) => void })
  .onmessage = (event) => {
    void runPython(event.data);
  };

async function runPython(input: WorkerInput): Promise<void> {
  const emit = createOutputEmitter(input.outputLimit);
  let start = 0;
  currentEmit = emit;

  try {
    pyodideReady ??= loadRuntime().catch((error: unknown) => {
      pyodideReady = undefined;
      throw error;
    });
    const pyodide = await pyodideReady;
    if (!hostApisBlocked) {
      blockHostApis();
      hostApisBlocked = true;
    }

    post({ type: "started" });
    start = performance.now();
    await pyodide.runPythonAsync(input.source);
    post({ type: "done", durationMs: performance.now() - start });
  } catch (error) {
    post({
      type: "error",
      error: start === 0 ? formatValue(error) : formatPythonError(error),
      durationMs: start === 0 ? 0 : performance.now() - start,
    });
  } finally {
    currentEmit = undefined;
  }
}

async function loadRuntime(): Promise<PyodideRuntime> {
  const pyodideModule = (await import(
    /* @vite-ignore */ pyodideModuleUrl
  )) as PyodideModule;

  return pyodideModule.loadPyodide({
    indexURL: pyodideBaseUrl,
    stdout: (text) => currentEmit?.("stdout", `${text}\n`),
    stderr: (text) => currentEmit?.("stderr", `${text}\n`),
  });
}
