import { API as WasmClang } from "@eduoj/wasm-clang";
import type { WorkerInput } from "./types";
import { createOutputEmitter, formatValue, post } from "./workerUtils";

type WasmClangApi = {
  compile(options: {
    input: string;
    contents: string;
    obj: string;
    clangFlags?: string[];
  }): Promise<unknown>;
  link(obj: string, wasm: string): Promise<unknown>;
  memfs: {
    getFileContents(path: string): Uint8Array;
    setStdinStr(input: string): void;
  };
  run(module: WebAssembly.Module, ...args: string[]): Promise<unknown>;
};

const toolchainBaseUrl = "https://cdn.jsdelivr.net/npm/@chriskoch/cpp-wasm@1.0.2/";
let compilerReady: Promise<WasmClangApi> | undefined;
let runCounter = 0;
let currentEmit:
  | ((stream: "stdout" | "stderr", text: string) => void)
  | undefined;
let currentHostStream: "stdout" | "stderr" = "stdout";

(globalThis as unknown as { onmessage: (event: MessageEvent<WorkerInput>) => void })
  .onmessage = (event) => {
    void runCpp(event.data);
  };

async function runCpp(input: WorkerInput): Promise<void> {
  const emit = createOutputEmitter(input.outputLimit);
  const start = performance.now();
  const runId = runCounter + 1;
  runCounter = runId;
  currentEmit = emit;

  try {
    const compiler = await getCompiler();
    const inputFile = `crustpad-${runId}.cc`;
    const objectFile = `crustpad-${runId}.o`;
    const wasmFile = `crustpad-${runId}.wasm`;

    await withHostStream("stderr", async () => {
      await compiler.compile({
        input: inputFile,
        contents: input.source,
        obj: objectFile,
        clangFlags: ["-std=c++17", "-fno-color-diagnostics"],
      });
      await compiler.link(objectFile, wasmFile);
    });

    const wasm = compiler.memfs.getFileContents(wasmFile);
    const program = await WebAssembly.compile(wasm);

    compiler.memfs.setStdinStr("");
    post({ type: "started" });
    await withHostStream("stdout", () => compiler.run(program, wasmFile));
    post({ type: "done", durationMs: performance.now() - start });
  } catch (error) {
    post({
      type: "error",
      error: formatValue(error),
      durationMs: performance.now() - start,
    });
  } finally {
    currentEmit = undefined;
  }
}

function getCompiler(): Promise<WasmClangApi> {
  compilerReady ??= Promise.resolve(
    new WasmClang({
      cdnUrl: toolchainBaseUrl,
      hostWrite: emitHostOutput,
      readBuffer,
      compileStreaming,
    }),
  ).catch((error: unknown) => {
    compilerReady = undefined;
    throw error;
  }) as Promise<WasmClangApi>;

  return compilerReady;
}

async function readBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  return response.arrayBuffer();
}

async function compileStreaming(url: string): Promise<WebAssembly.Module> {
  const buffer = await readBuffer(url);
  return WebAssembly.compile(buffer);
}

async function withHostStream<T>(
  stream: "stdout" | "stderr",
  operation: () => Promise<T>,
): Promise<T> {
  const previousStream = currentHostStream;
  currentHostStream = stream;

  try {
    return await operation();
  } finally {
    currentHostStream = previousStream;
  }
}

function emitHostOutput(text: string): void {
  currentEmit?.(
    currentHostStream,
    currentHostStream === "stderr" ? stripAnsi(text) : text,
  );
}

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
}
