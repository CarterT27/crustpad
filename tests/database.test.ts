import { afterEach, describe, expect, test } from "bun:test";
import { Database as SQLite } from "bun:sqlite";
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

  test("deletes expired documents while keeping active rooms", () => {
    const path = tempDatabasePath();
    const store = new DocumentStore(path);

    store.store("expired", { text: "old", language: "javascript" }, 100);
    store.store("active", { text: "active", language: "typescript" }, 100);
    store.store("fresh", { text: "fresh", language: "python" }, 2_000);

    expect(store.deleteExpired(1_000, ["active"])).toBe(1);

    expect(store.load("expired")).toBeUndefined();
    expect(store.load("active")).toEqual({
      text: "active",
      language: "typescript",
    });
    expect(store.load("fresh")).toEqual({
      text: "fresh",
      language: "python",
    });
    expect(store.count()).toBe(2);
  });

  test("touch keeps an unchanged document from expiring", () => {
    const path = tempDatabasePath();
    const store = new DocumentStore(path);

    store.store("room", { text: "hello", language: "javascript" }, 100);
    store.touch("room", 2_000);

    expect(store.deleteExpired(1_000)).toBe(0);
    expect(store.load("room")).toEqual({
      text: "hello",
      language: "javascript",
    });
  });

  test("migrates existing documents without immediately expiring them", () => {
    const path = tempDatabasePath();
    const db = new SQLite(path, { create: true });
    db.exec(`
      CREATE TABLE document (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        language TEXT
      )
    `);
    db.query("INSERT INTO document (id, text, language) VALUES (?, ?, ?)").run(
      "legacy",
      "saved",
      "plaintext",
    );
    db.close();

    const beforeMigration = Date.now();
    const store = new DocumentStore(path);

    expect(store.deleteExpired(beforeMigration - 1)).toBe(0);
    expect(store.load("legacy")).toEqual({
      text: "saved",
      language: "plaintext",
    });
  });
});

function tempDatabasePath(): string {
  const path = `/tmp/crustpad-test-${process.pid}-${Date.now()}-${Math.random()}.sqlite`;
  paths.add(path);
  return path;
}
