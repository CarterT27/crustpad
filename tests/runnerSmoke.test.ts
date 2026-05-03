import { afterAll, describe, expect, test } from "bun:test";
import type { WorkerOutput } from "../src/runner/types";

type WorkerRunResult = {
  status: "completed" | "error";
  stdout: string;
  stderr: string;
  error?: string;
};

describe("runner smoke tests", () => {
  const runners: WorkerRunner[] = [];

  afterAll(() => {
    for (const runner of runners) {
      runner.terminate();
    }
  });

  test("runs C and does not mistake printed file locations for diagnostics", async () => {
    const runner = createWorkerRunner("../src/runner/c.worker.ts");
    runners.push(runner);

    const result = await runner.run(`
      #include <stdio.h>

      int main(void) {
        printf("file.c:1:1\\n");
        return 0;
      }
    `);

    expect(result.status).toBe("completed");
    expect(result.stdout).toContain("file.c:1:1");
    expect(result.stderr).toBe("");
    expect(result.error).toBeUndefined();
  });

  test("reports C compile diagnostics as errors", async () => {
    const runner = createWorkerRunner("../src/runner/c.worker.ts");
    runners.push(runner);

    const result = await runner.run("int main(void) { syntax error }");

    expect(result.status).toBe("error");
    expect(result.stdout).toContain("file.c:");
    expect(result.error).toBe("C runner reported a compile or runtime diagnostic.");
  });

  test(
    "runs C++ and reports compiler diagnostics on stderr without ANSI escapes",
    async () => {
      const runner = createWorkerRunner("../src/runner/cpp.worker.ts");
      runners.push(runner);

      const success = await runner.run(`
        #include <iostream>

        int main() {
          std::cout << "hi from cpp\\n";
          return 0;
        }
      `);

      expect(success.status).toBe("completed");
      expect(success.stdout).toContain("hi from cpp");
      expect(success.stderr).toBe("");

      const failure = await runner.run("int main() { syntax error }");

      expect(failure.status).toBe("error");
      expect(failure.stdout).not.toContain("unknown type name");
      expect(failure.stderr).toContain("error:");
      expect(failure.stderr).not.toMatch(/\x1b\[[0-?]*[ -/]*[@-~]/);
    },
    120_000,
  );
});

type PendingRun = {
  reject: (error: Error) => void;
  resolve: (result: WorkerRunResult) => void;
  stderr: string;
  stdout: string;
  timeout: Timer;
};

type WorkerRunner = {
  run(source: string): Promise<WorkerRunResult>;
  terminate(): void;
};

function createWorkerRunner(workerPath: string): WorkerRunner {
  const worker = new Worker(new URL(workerPath, import.meta.url), {
    type: "module",
  });
  let pending: PendingRun | undefined;

  worker.addEventListener("message", (event: MessageEvent<WorkerOutput>) => {
    if (!pending) {
      return;
    }

    const message = event.data;
    switch (message.type) {
      case "chunk":
        if (message.stream === "stdout") {
          pending.stdout += message.text;
        } else {
          pending.stderr += message.text;
        }
        break;
      case "done":
        finish({ status: "completed" });
        break;
      case "error":
        finish({ status: "error", error: message.error });
        break;
      case "limit":
      case "started":
        break;
    }
  });

  worker.addEventListener("error", (event) => {
    if (!pending) {
      return;
    }

    const message = event instanceof ErrorEvent ? event.message : "Worker error";
    const { reject } = pending;
    cleanup();
    reject(new Error(message));
  });

  return {
    run(source: string) {
      if (pending) {
        return Promise.reject(new Error("Worker runner is already running."));
      }

      return new Promise<WorkerRunResult>((resolve, reject) => {
        pending = {
          reject,
          resolve,
          stderr: "",
          stdout: "",
          timeout: setTimeout(() => {
            cleanup();
            reject(new Error(`Worker runner timed out for ${workerPath}.`));
          }, 120_000),
        };

        worker.postMessage({ source, outputLimit: 64 * 1024 });
      });
    },
    terminate() {
      cleanup();
      worker.terminate();
    },
  };

  function finish(result: Pick<WorkerRunResult, "status" | "error">): void {
    if (!pending) {
      return;
    }

    const { resolve, stdout, stderr } = pending;
    cleanup();
    resolve({
      ...result,
      stdout,
      stderr,
    });
  }

  function cleanup(): void {
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    pending = undefined;
  }
}
