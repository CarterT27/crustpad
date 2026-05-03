import { describe, expect, test } from "bun:test";
import { formatPythonError } from "../src/runner/pythonErrors";

describe("formatPythonError", () => {
  test("prefers the Python traceback over the Pyodide JavaScript stack", () => {
    const error = new Error(
      [
        "PythonError: Traceback (most recent call last):",
        '  File "<exec>", line 1, in <module>',
        "ModuleNotFoundError: No module named 'pandas'",
      ].join("\n"),
    );
    error.stack = [
      "k@https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.asm.js:10:50112",
      "@https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.asm.wasm:wasm-function[308]:0x16dd24",
    ].join("\n");

    const formatted = formatPythonError(error);

    expect(formatted).toContain("Traceback (most recent call last):");
    expect(formatted).toContain("ModuleNotFoundError: No module named 'pandas'");
    expect(formatted).not.toContain("pyodide.asm.js");
    expect(formatted).not.toContain("wasm-function");
  });

  test("keeps ordinary Python exception messages readable", () => {
    expect(formatPythonError(new Error("ZeroDivisionError: division by zero"))).toBe(
      "ZeroDivisionError: division by zero",
    );
  });
});
