import { RunDefault } from "picoc-web";
import type { WorkerInput } from "./types";
import { createOutputEmitter, formatValue, post } from "./workerUtils";

(globalThis as unknown as { onmessage: (event: MessageEvent<WorkerInput>) => void })
  .onmessage = (event) => {
    void runC(event.data);
  };

async function runC(input: WorkerInput): Promise<void> {
  const start = performance.now();
  const emit = createOutputEmitter(input.outputLimit);

  try {
    post({ type: "started" });
    const result = await RunDefault(input.source);

    if (result.stdout) {
      emit("stdout", result.stdout);
    }

    if (result.stderr) {
      emit("stderr", result.stderr);
    }

    if (isPicoCDiagnostic(result.stdout) || isPicoCDiagnostic(result.stderr)) {
      post({
        type: "error",
        error: "C runner reported a compile or runtime diagnostic.",
        durationMs: performance.now() - start,
      });
      return;
    }

    post({ type: "done", durationMs: performance.now() - start });
  } catch (error) {
    post({
      type: "error",
      error: formatValue(error),
      durationMs: performance.now() - start,
    });
  }
}

function isPicoCDiagnostic(output: string): boolean {
  return /(?:^|\n)[^\n]*\n[ \t]*\^[^\n]*\nfile\.c:\d+:\d+ [^\n]+/.test(
    output,
  );
}
