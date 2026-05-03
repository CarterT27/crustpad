import type { WorkerInput } from "./types";
import { executeJavaScript } from "./workerUtils";

(globalThis as unknown as { onmessage: (event: MessageEvent<WorkerInput>) => void })
  .onmessage = (event) => {
    void executeJavaScript(
      event.data.source,
      event.data.outputLimit,
      "crustpad-runner.js",
    );
  };
