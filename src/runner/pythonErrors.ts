import { formatValue } from "./workerUtils";

export function formatPythonError(error: unknown): string {
  const message = stringProperty(error, "message");
  return cleanPythonMessage(message ?? formatValue(error));
}

function cleanPythonMessage(message: string): string {
  const trimmed = message.trim();
  return trimmed.startsWith("PythonError: ")
    ? trimmed.slice("PythonError: ".length).trim()
    : trimmed;
}

function stringProperty(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || !(key in value)) {
    return undefined;
  }

  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" && property.length > 0 ? property : undefined;
}
