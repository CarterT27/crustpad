import { describe, expect, test } from "bun:test";
import { Room } from "../src/room";

describe("Room", () => {
  test("transforms edits sent from stale revisions", () => {
    const room = new Room("test");

    room["applyEdit"](1, 0, [{ type: "insert", text: "abc" }]);
    room["applyEdit"](2, 0, [{ type: "insert", text: "xyz" }]);

    expect(room.text).toBe("xyzabc");
    expect(room.revision).toBe(2);
  });

  test("loads persisted text as a synthetic insert operation", () => {
    const room = new Room("saved", {
      text: "hello",
      language: "typescript",
    });

    expect(room.text).toBe("hello");
    expect(room.language).toBe("typescript");
    expect(room.revision).toBe(1);
    expect(room.operations).toEqual([
      { id: Number.MAX_SAFE_INTEGER, operation: [{ type: "insert", text: "hello" }] },
    ]);
    expect(room.snapshot()).toEqual({
      text: "hello",
      language: "typescript",
    });
  });
});
