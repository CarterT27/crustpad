import { afterEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { DocumentStore } from "../src/database";

const paths = new Set<string>();

afterEach(() => {
  for (const path of paths) {
    try {
      unlinkSync(path);
    } catch {
      // Missing files are fine; each test owns a unique database path.
    }
  }
  paths.clear();
});

describe("DocumentStore", () => {
  test("stores latest document snapshots", () => {
    const path = tempDatabasePath();
    const store = new DocumentStore(path);

    expect(store.load("room")).toBeUndefined();
    expect(store.count()).toBe(0);

    store.store("room", { text: "hello", language: "javascript" });
    store.store("room", { text: "hello world", language: "typescript" });

    expect(store.load("room")).toEqual({
      text: "hello world",
      language: "typescript",
    });
    expect(store.count()).toBe(1);
  });
});

function tempDatabasePath(): string {
  const path = `/tmp/crustpad-test-${process.pid}-${Date.now()}-${Math.random()}.sqlite`;
  paths.add(path);
  return path;
}
