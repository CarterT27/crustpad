import type { LanguageId } from "../protocol";
import CWorker from "./c.worker?worker";
import CppWorker from "./cpp.worker?worker";
import JavaScriptWorker from "./js.worker?worker";
import PythonWorker from "./python.worker?worker";
import TypeScriptWorker from "./ts.worker?worker";
import type { RunResult, RunnableLanguage, WorkerOutput } from "./types";

export type { RunResult };

const defaultOutputLimit = 64 * 1024;
const defaultTimeoutMs = 15_000;
const defaultSetupTimeoutMs = 60_000;
const defaultCppSetupTimeoutMs = 180_000;

const workerFactories: Record<RunnableLanguage, () => Worker> = {
  c: () => new CWorker(),
  cpp: () => new CppWorker(),
  javascript: () => new JavaScriptWorker(),
  python: () => new PythonWorker(),
  typescript: () => new TypeScriptWorker(),
};

let pythonWorker: Worker | undefined;

// ponytail: probe compiles an 8-byte module; catches CSP/policy blocks that a
// typeof check misses. Add per-worker probes only if main-thread CSP ever diverges.
function wasmEnabled(): boolean {
  try {
    return (
      new WebAssembly.Instance(
        new WebAssembly.Module(Uint8Array.of(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0)),
      ) instanceof WebAssembly.Instance
    );
  } catch {
    return false;
  }
}

export function canRunLanguage(language: LanguageId): language is RunnableLanguage {
  return language in workerFactories;
}

export function runCode({
  language,
  source,
  outputLimit = defaultOutputLimit,
  timeoutMs = defaultTimeoutMs,
  setupTimeoutMs = defaultSetupTimeoutMs,
}: {
  language: LanguageId;
  source: string;
  outputLimit?: number;
  timeoutMs?: number;
  setupTimeoutMs?: number;
}): Promise<RunResult> {
  if (!canRunLanguage(language)) {
    return Promise.resolve({
      status: "unsupported",
      language,
      stdout: "",
      stderr: "",
      timedOut: false,
      outputTruncated: false,
    });
  }

  if (language !== "javascript" && !wasmEnabled()) {
    return Promise.resolve({
      status: "error",
      language,
      stdout: "",
      stderr: "",
      error:
        "WebAssembly is disabled in this browser (often by an IT policy or extension). JavaScript still runs; ask your admin to allow WebAssembly for this site.",
      timedOut: false,
      outputTruncated: false,
    });
  }

  return new Promise((resolve) => {
    const effectiveSetupTimeoutMs =
      language === "cpp" && setupTimeoutMs === defaultSetupTimeoutMs
        ? defaultCppSetupTimeoutMs
        : setupTimeoutMs;
    const worker = workerForLanguage(language);
    const setupStartedAt = performance.now();
    let executionStartedAt = setupStartedAt;
    let stdout = "";
    let stderr = "";
    let outputTruncated = false;
    let settled = false;
    let executionTimer: number | undefined;
    let terminateWorker = language !== "python";

    const finish = (
      result: Omit<RunResult, "language" | "outputTruncated" | "stdout" | "stderr">,
    ) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(setupTimer);
      if (executionTimer !== undefined) {
        window.clearTimeout(executionTimer);
      }

      if (terminateWorker || result.timedOut) {
        worker.terminate();
        if (language === "python" && worker === pythonWorker) {
          pythonWorker = undefined;
        }
      }

      resolve({
        ...result,
        language,
        stdout,
        stderr,
        outputTruncated,
      });
    };

    const setupTimer = window.setTimeout(() => {
      outputTruncated = outputTruncated || stdout.length + stderr.length >= outputLimit;
      finish({
        status: "timed-out",
        durationMs: performance.now() - setupStartedAt,
        timedOut: true,
        error: `Runner initialization timed out after ${Math.round(
          effectiveSetupTimeoutMs / 1000,
        )} seconds.`,
      });
    }, effectiveSetupTimeoutMs);

    const startExecutionTimer = () => {
      if (executionTimer !== undefined) {
        return;
      }

      window.clearTimeout(setupTimer);
      executionStartedAt = performance.now();
      executionTimer = window.setTimeout(() => {
        outputTruncated = outputTruncated || stdout.length + stderr.length >= outputLimit;
        finish({
          status: "timed-out",
          durationMs: performance.now() - executionStartedAt,
          timedOut: true,
          error: `Execution timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
        });
      }, timeoutMs);
    };

    worker.onmessage = (event: MessageEvent<WorkerOutput>) => {
      const message = event.data;

      switch (message.type) {
        case "started":
          startExecutionTimer();
          break;
        case "chunk":
          if (message.stream === "stdout") {
            stdout = appendCapped(stdout, message.text, outputLimit);
          } else {
            stderr = appendCapped(stderr, message.text, outputLimit);
          }
          break;
        case "limit":
          outputTruncated = true;
          break;
        case "done":
          finish({
            status: "completed",
            durationMs: message.durationMs,
            timedOut: false,
          });
          break;
        case "error":
          finish({
            status: "error",
            durationMs: message.durationMs,
            timedOut: false,
            error: message.error,
          });
          break;
      }
    };

    worker.onerror = (event) => {
      terminateWorker = true;
      finish({
        status: "error",
        durationMs: performance.now() - setupStartedAt,
        timedOut: false,
        error: event.message,
      });
    };

    worker.postMessage({ source, outputLimit });
  });
}

function appendCapped(existing: string, chunk: string, limit: number): string {
  return `${existing}${chunk}`.slice(0, limit);
}

function workerForLanguage(language: RunnableLanguage): Worker {
  if (language === "python") {
    pythonWorker ??= workerFactories.python();
    return pythonWorker;
  }

  return workerFactories[language]();
}
