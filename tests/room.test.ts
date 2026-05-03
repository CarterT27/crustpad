import { describe, expect, test } from "bun:test";
import { Room } from "../src/room";

function socket(userId = 1) {
  return {
    data: { roomId: "test", userId },
    sent: [] as string[],
    closeCode: undefined as number | undefined,
    closeReason: undefined as string | undefined,
    send(message: string) {
      this.sent.push(message);
    },
    close(code: number, reason: string) {
      this.closeCode = code;
      this.closeReason = reason;
    },
  };
}

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

  test("rejects edits from future revisions without changing state", () => {
    const room = new Room("test");
    const ws = socket();

    expect(() =>
      room.handle(
        ws as never,
        JSON.stringify({
          type: "edit",
          revision: 1,
          operation: [{ type: "insert", text: "stale" }],
        }),
      ),
    ).toThrow("invalid revision 1");
    expect(room.text).toBe("");
    expect(room.revision).toBe(0);
    expect(room.operations).toEqual([]);
  });

  test("clears presence and cursor state when a collaborator disconnects", () => {
    const room = new Room("test");
    const first = socket();
    const second = socket();
    room.connect(first as never);
    room.connect(second as never);
    first.sent = [];
    second.sent = [];

    room.handle(
      first as never,
      JSON.stringify({
        type: "clientInfo",
        info: { name: "Ada", hue: 120 },
      }),
    );
    room.handle(
      first as never,
      JSON.stringify({
        type: "cursorData",
        data: { cursors: [0], selections: [] },
      }),
    );

    expect(room.users.size).toBe(1);
    expect(room.cursors.size).toBe(1);

    room.disconnect(first as never);

    expect(room.users.size).toBe(0);
    expect(room.cursors.size).toBe(0);
    expect(JSON.parse(second.sent.at(-1) ?? "")).toEqual({
      type: "userInfo",
      id: 0,
      info: null,
    });
  });

  test("rejects user info outside protocol bounds", () => {
    const room = new Room("test");
    const ws = socket();

    room.handle(
      ws as never,
      JSON.stringify({
        type: "clientInfo",
        info: { name: "x".repeat(26), hue: 120 },
      }),
    );
    expect(ws.closeCode).toBe(1003);
    expect(room.users.size).toBe(0);

    const second = socket();
    room.handle(
      second as never,
      JSON.stringify({
        type: "clientInfo",
        info: { name: "Ada", hue: 360 },
      }),
    );
    expect(second.closeCode).toBe(1003);
    expect(room.users.size).toBe(0);
  });

  test("rejects oversized or out-of-range cursor data", () => {
    const room = new Room("test");
    room["applyEdit"](1, 0, [{ type: "insert", text: "abc" }]);

    const tooManyCursors = socket();
    room.handle(
      tooManyCursors as never,
      JSON.stringify({
        type: "cursorData",
        data: {
          cursors: Array.from({ length: 17 }, () => 0),
          selections: [],
        },
      }),
    );
    expect(tooManyCursors.closeCode).toBe(1003);
    expect(room.cursors.size).toBe(0);

    const outOfRangeSelection = socket();
    room.handle(
      outOfRangeSelection as never,
      JSON.stringify({
        type: "cursorData",
        data: {
          cursors: [],
          selections: [[0, 4]],
        },
      }),
    );
    expect(outOfRangeSelection.closeCode).toBe(1003);
    expect(room.cursors.size).toBe(0);
  });
});
