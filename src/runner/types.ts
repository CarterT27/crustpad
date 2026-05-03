import type { LanguageId } from "../protocol";

export type RunnableLanguage = Exclude<LanguageId, "plaintext">;

export type OutputStream = "stdout" | "stderr";

export type WorkerInput = {
  source: string;
  outputLimit: number;
};

export type WorkerOutput =
  | { type: "chunk"; stream: OutputStream; text: string }
  | { type: "limit" }
  | { type: "started" }
  | { type: "done"; durationMs: number }
  | { type: "error"; error: string; durationMs: number };

export type RunResult = {
  status: "completed" | "error" | "timed-out" | "unsupported";
  language: LanguageId;
  stdout: string;
  stderr: string;
  error?: string;
  durationMs?: number;
  timedOut: boolean;
  outputTruncated: boolean;
};
