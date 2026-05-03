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
});
