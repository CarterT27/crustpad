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
  test("transforms edits sent from stale revisions", async () => {
    const room = new Room("test");

    await room["applyEdit"](1, 0, [{ type: "insert", text: "abc" }]);
    await room["applyEdit"](2, 0, [{ type: "insert", text: "xyz" }]);

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

  test("reserves restored author ids without reserving the snapshot sentinel", () => {
    const restored = new Room("restored");
    restored.restoreOperations([
      { id: 0, operation: [{ type: "insert", text: "a" }] },
      { id: 2, operation: [{ type: "insert", text: "b" }] },
      { id: Number.MAX_SAFE_INTEGER, operation: [] },
    ]);
    const fresh = socket();
    restored.connect(fresh as never);
    expect(JSON.parse(fresh.sent[0] ?? "")).toEqual({ type: "identity", id: 3 });

    const withSocket = new Room("attached");
    withSocket.restoreOperations([
      { id: 2, operation: [{ type: "insert", text: "a" }] },
    ]);
    withSocket.restoreSocket(socket(5) as never);
    const afterSocket = socket();
    withSocket.connect(afterSocket as never);
    expect(JSON.parse(afterSocket.sent[0] ?? "")).toEqual({
      type: "identity",
      id: 6,
    });

    const snapshotOnly = new Room("snapshot", {
      text: "hello",
      language: "plaintext",
    });
    const first = socket();
    snapshotOnly.connect(first as never);
    expect(JSON.parse(first.sent[0] ?? "")).toEqual({ type: "identity", id: 0 });
  });

  test("rejects edits from future revisions without changing state", async () => {
    const room = new Room("test");
    const ws = socket();

    await expect(
      room.handle(
        ws as never,
        JSON.stringify({
          type: "edit",
          revision: 1,
          operation: [{ type: "insert", text: "stale" }],
        }),
      ),
    ).rejects.toThrow("invalid revision 1");
    expect(room.text).toBe("");
    expect(room.revision).toBe(0);
    expect(room.operations).toEqual([]);
  });

  test("rejects malformed edit operations before applying OT", async () => {
    const invalidOperations = [
      [{ type: "retain", count: -1 }],
      [{ type: "delete", count: 1.5 }],
      [{ type: "insert", text: 42 }],
      [{ type: "replace", text: "x" }],
      [null],
    ];

    for (const operation of invalidOperations) {
      const room = new Room("test");
      const ws = socket();

      await room.handle(
        ws as never,
        JSON.stringify({
          type: "edit",
          revision: 0,
          operation,
        }),
      );

      expect(ws.closeCode).toBe(1003);
      expect(ws.closeReason).toBe("invalid message");
      expect(room.text).toBe("");
      expect(room.revision).toBe(0);
      expect(room.operations).toEqual([]);
    }
  });

  test("clears presence and cursor state when a collaborator disconnects", async () => {
    const room = new Room("test");
    const first = socket();
    const second = socket();
    room.connect(first as never);
    room.connect(second as never);
    expect(room.connectionCount).toBe(2);
    first.sent = [];
    second.sent = [];

    await room.handle(
      first as never,
      JSON.stringify({
        type: "clientInfo",
        info: { name: "Ada", hue: 120 },
      }),
    );
    await room.handle(
      first as never,
      JSON.stringify({
        type: "cursorData",
        data: { cursors: [0], selections: [] },
      }),
    );

    expect(room.users.size).toBe(1);
    expect(room.cursors.size).toBe(1);

    room.disconnect(first as never);

    expect(room.connectionCount).toBe(1);
    expect(room.users.size).toBe(0);
    expect(room.cursors.size).toBe(0);
    expect(JSON.parse(second.sent.at(-1) ?? "")).toEqual({
      type: "userInfo",
      id: 0,
      info: null,
    });
  });

  test("prunes sockets that throw during broadcast", async () => {
    const room = new Room("test");
    const stale = socket();
    const live = socket();
    room.connect(stale as never);
    room.connect(live as never);

    await room.handle(
      stale as never,
      JSON.stringify({
        type: "clientInfo",
        info: { name: "Ada", hue: 120 },
      }),
    );
    await room.handle(
      stale as never,
      JSON.stringify({
        type: "cursorData",
        data: { cursors: [0], selections: [] },
      }),
    );
    stale.send = () => {
      throw new Error("closed");
    };
    live.sent = [];

    await room.handle(
      live as never,
      JSON.stringify({
        type: "clientInfo",
        info: { name: "Grace", hue: 180 },
      }),
    );

    expect(room.connectionCount).toBe(1);
    expect(room.users.has(0)).toBe(false);
    expect(room.cursors.has(0)).toBe(false);
    expect(live.sent.map((message) => JSON.parse(message))).toContainEqual({
      type: "userInfo",
      id: 0,
      info: null,
    });
  });

  test("runs the history persistence hook before broadcasting edits", async () => {
    const room = new Room("test");
    const ws = socket();
    const events: string[] = [];
    ws.send = (message: string) => {
      events.push("send");
      ws.sent.push(message);
    };
    room.connect(ws as never);
    events.length = 0;
    room.beforeHistoryBroadcast = async () => {
      events.push("persist");
    };

    await room.handle(
      ws as never,
      JSON.stringify({
        type: "edit",
        revision: 0,
        operation: [{ type: "insert", text: "a" }],
      }),
    );

    expect(events).toEqual(["persist", "send"]);
  });

  test("does not commit or broadcast edits when persistence fails", async () => {
    const room = new Room("test");
    const ws = socket();
    room.connect(ws as never);
    ws.sent = [];
    room.beforeHistoryBroadcast = async (state) => {
      expect(state.document.text).toBe("a");
      expect(state.operations).toEqual([
        { id: 0, operation: [{ type: "insert", text: "a" }] },
      ]);
      throw new Error("write failed");
    };

    await expect(
      room.handle(
        ws as never,
        JSON.stringify({
          type: "edit",
          revision: 0,
          operation: [{ type: "insert", text: "a" }],
        }),
      ),
    ).rejects.toThrow("write failed");

    expect(room.text).toBe("");
    expect(room.revision).toBe(0);
    expect(room.operations).toEqual([]);
    expect(ws.sent).toEqual([]);
  });

  test("rejects user info outside protocol bounds", async () => {
    const room = new Room("test");
    const ws = socket();

    await room.handle(
      ws as never,
      JSON.stringify({
        type: "clientInfo",
        info: { name: "x".repeat(26), hue: 120 },
      }),
    );
    expect(ws.closeCode).toBe(1003);
    expect(room.users.size).toBe(0);

    const second = socket();
    await room.handle(
      second as never,
      JSON.stringify({
        type: "clientInfo",
        info: { name: "Ada", hue: 360 },
      }),
    );
    expect(second.closeCode).toBe(1003);
    expect(room.users.size).toBe(0);
  });

  test("rejects oversized or out-of-range cursor data", async () => {
    const room = new Room("test");
    await room["applyEdit"](1, 0, [{ type: "insert", text: "abc" }]);

    const tooManyCursors = socket();
    await room.handle(
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
    await room.handle(
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
