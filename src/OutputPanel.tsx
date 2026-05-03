import type { LanguageId } from "./protocol";
import type { RunResult } from "./runner/run";

export type RunPanelState =
  | { status: "idle"; language: LanguageId }
  | { status: "running"; language: LanguageId }
  | RunResult;

export function OutputPanel({ result }: { result: RunPanelState }) {
  const duration =
    "durationMs" in result && result.durationMs !== undefined
      ? `${Math.round(result.durationMs)}ms`
      : null;
  const timedOut = "timedOut" in result && result.timedOut;
  const outputTruncated = "outputTruncated" in result && result.outputTruncated;
  const stdout = "stdout" in result ? result.stdout : "";
  const stderr = "stderr" in result ? result.stderr : "";
  const error = "error" in result ? result.error : undefined;

  return (
    <section className="output-panel">
      <div className="output-header">
        <span>Output</span>
        <div className="output-meta">
          <span className={`run-status ${result.status}`}>{statusText(result.status)}</span>
          {duration ? <span>{duration}</span> : null}
          {timedOut ? <span>timeout</span> : null}
          {outputTruncated ? <span>truncated</span> : null}
        </div>
      </div>

      <div className="output-streams">
        <OutputStream title="stdout" value={stdout} />
        <OutputStream title="stderr" value={stderr} />
        <OutputStream title="errors" value={error ?? ""} />
      </div>
    </section>
  );
}

function OutputStream({ title, value }: { title: string; value: string }) {
  return (
    <div className="output-stream">
      <div className="output-stream-title">{title}</div>
      <pre>{value || ""}</pre>
    </div>
  );
}

function statusText(status: RunPanelState["status"]): string {
  switch (status) {
    case "completed":
      return "completed";
    case "error":
      return "error";
    case "idle":
      return "idle";
    case "running":
      return "running";
    case "timed-out":
      return "timed out";
    case "unsupported":
      return "unsupported";
  }
}
