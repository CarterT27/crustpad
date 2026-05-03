import type { OutputStream, WorkerOutput } from "./types";

type ConsoleMethod = (...args: unknown[]) => void;
type TimerHandle = ReturnType<typeof setTimeout>;
type IntervalHandle = ReturnType<typeof setInterval>;

type RunnerGlobal = typeof globalThis & {
  EventSource?: unknown;
  SharedWorker?: unknown;
  XMLHttpRequest?: unknown;
  caches?: unknown;
  indexedDB?: unknown;
};

export function createOutputEmitter(outputLimit: number) {
  let remaining = outputLimit;
  let limitPosted = false;

  return (stream: OutputStream, text: string) => {
    if (remaining <= 0) {
      postLimitOnce();
      return;
    }

    const chunk = text.slice(0, remaining);
    remaining -= chunk.length;
    post({ type: "chunk", stream, text: chunk });

    if (chunk.length < text.length) {
      postLimitOnce();
    }
  };

  function postLimitOnce() {
    if (!limitPosted) {
      limitPosted = true;
      post({ type: "limit" });
    }
  }
}

export async function executeJavaScript(
  source: string,
  outputLimit: number,
  sourceName: string,
): Promise<void> {
  const start = performance.now();
  const emit = createOutputEmitter(outputLimit);
  const restoreConsole = captureConsole(emit);
  const restoreHostApis = blockHostApis();
  const asyncTracker = trackAsyncWork();
  const blob = new Blob([`${source}\n//# sourceURL=${sourceName}`], {
    type: "text/javascript",
  });
  const url = URL.createObjectURL(blob);

  try {
    post({ type: "started" });
    await import(/* @vite-ignore */ url);
    await asyncTracker.waitForIdle();
    post({ type: "done", durationMs: performance.now() - start });
  } catch (error) {
    post({
      type: "error",
      error: formatValue(error),
      durationMs: performance.now() - start,
    });
  } finally {
    URL.revokeObjectURL(url);
    asyncTracker.restore();
    restoreHostApis();
    restoreConsole();
  }
}

export function blockHostApis(): () => void {
  const host = globalThis as RunnerGlobal;
  const blocked = [
    "BroadcastChannel",
    "EventSource",
    "SharedWorker",
    "WebSocket",
    "Worker",
    "XMLHttpRequest",
    "caches",
    "fetch",
    "indexedDB",
  ] as const;
  const restoreCallbacks: Array<() => void> = [];

  for (const name of blocked) {
    const descriptor = Object.getOwnPropertyDescriptor(host, name);
    if (descriptor === undefined && !(name in host)) {
      continue;
    }

    restoreCallbacks.push(() => {
      if (descriptor) {
        Object.defineProperty(host, name, descriptor);
      } else {
        delete host[name];
      }
    });

    try {
      Object.defineProperty(host, name, {
        configurable: true,
        get() {
          throw new Error(`${name} is disabled in the code runner.`);
        },
      });
    } catch {
      // Some browser-provided globals are non-configurable. The worker CSP still
      // blocks network paths in production when a property cannot be replaced.
    }
  }

  return () => {
    for (const restore of restoreCallbacks.reverse()) {
      restore();
    }
  };
}

export function formatValue(value: unknown): string {
  if (value instanceof Error) {
    return value.stack || value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "undefined") {
    return "undefined";
  }

  if (typeof value === "function") {
    return value.toString();
  }

  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value, circularReplacer(), 2);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

export function formatConsoleArgs(args: unknown[]): string {
  return `${args.map(formatValue).join(" ")}\n`;
}

export function post(message: WorkerOutput): void {
  (globalThis as unknown as { postMessage: (message: WorkerOutput) => void })
    .postMessage(message);
}

function captureConsole(
  emit: (stream: OutputStream, text: string) => void,
): () => void {
  const original = {
    debug: console.debug,
    error: console.error,
    info: console.info,
    log: console.log,
    warn: console.warn,
  };

  const stdout: ConsoleMethod = (...args) => emit("stdout", formatConsoleArgs(args));
  const stderr: ConsoleMethod = (...args) => emit("stderr", formatConsoleArgs(args));

  console.debug = stdout;
  console.info = stdout;
  console.log = stdout;
  console.error = stderr;
  console.warn = stderr;

  return () => {
    console.debug = original.debug;
    console.error = original.error;
    console.info = original.info;
    console.log = original.log;
    console.warn = original.warn;
  };
}

function trackAsyncWork(): {
  restore: () => void;
  waitForIdle: () => Promise<void>;
} {
  const originalSetTimeout = globalThis.setTimeout.bind(globalThis);
  const originalClearTimeout = globalThis.clearTimeout.bind(globalThis);
  const originalSetInterval = globalThis.setInterval.bind(globalThis);
  const originalClearInterval = globalThis.clearInterval.bind(globalThis);
  const timeouts = new Set<TimerHandle>();
  const intervals = new Set<IntervalHandle>();

  globalThis.setTimeout = ((
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ) => {
    let handle: TimerHandle;
    handle = originalSetTimeout(() => {
      timeouts.delete(handle);
      callTimerHandler(handler, args);
    }, timeout);
    timeouts.add(handle);
    return handle;
  }) as unknown as typeof globalThis.setTimeout;

  globalThis.clearTimeout = ((handle?: TimerHandle) => {
    if (handle !== undefined) {
      timeouts.delete(handle);
    }
    originalClearTimeout(handle);
  }) as typeof globalThis.clearTimeout;

  globalThis.setInterval = ((
    handler: TimerHandler,
    timeout?: number,
    ...args: unknown[]
  ) => {
    const handle = originalSetInterval(() => {
      callTimerHandler(handler, args);
    }, timeout);
    intervals.add(handle);
    return handle;
  }) as unknown as typeof globalThis.setInterval;

  globalThis.clearInterval = ((handle?: IntervalHandle) => {
    if (handle !== undefined) {
      intervals.delete(handle);
    }
    originalClearInterval(handle);
  }) as typeof globalThis.clearInterval;

  return {
    restore() {
      globalThis.setTimeout = originalSetTimeout as typeof globalThis.setTimeout;
      globalThis.clearTimeout = originalClearTimeout as typeof globalThis.clearTimeout;
      globalThis.setInterval = originalSetInterval as typeof globalThis.setInterval;
      globalThis.clearInterval = originalClearInterval as typeof globalThis.clearInterval;
    },
    waitForIdle() {
      return new Promise((resolve) => {
        const checkIdle = () => {
          if (timeouts.size === 0 && intervals.size === 0) {
            originalSetTimeout(() => {
              if (timeouts.size === 0 && intervals.size === 0) {
                resolve();
              } else {
                checkIdle();
              }
            }, 25);
            return;
          }

          originalSetTimeout(checkIdle, 25);
        };

        checkIdle();
      });
    },
  };
}

function callTimerHandler(handler: TimerHandler, args: unknown[]): void {
  if (typeof handler === "function") {
    handler(...args);
    return;
  }

  new Function(handler)();
}

function circularReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();

  return (_key, value) => {
    if (!value || typeof value !== "object") {
      return value;
    }

    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);
    return value;
  };
}
