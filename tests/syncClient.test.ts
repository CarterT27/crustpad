import { afterEach, describe, expect, test } from "bun:test";
import { apply, transform, type OperationSeq } from "../src/ot";
import type { ServerMsg } from "../src/protocol";
import { SyncClient } from "../src/syncClient";

type GlobalWithFakes = {
  document: unknown;
  window: unknown;
  WebSocket: unknown;
};

type Change = {
  rangeOffset: number;
  rangeLength: number;
  text: string;
};

let cleanupDom = () => {};
const MONACO_KEY_CODE_Z = 56;

afterEach(() => {
  cleanupDom();
  cleanupDom = () => {};
});

describe("SyncClient connection state", () => {
  test("reconnects after a clean disconnect with no outstanding edits", () => {
    const env = installDom();
    const editor = new FakeEditor();
    let connected = 0;
    let disconnected = 0;
    let desynchronized = 0;
    const users: Array<Record<number, unknown>> = [];

    const client = new SyncClient({
      uri: "ws://example.test/api/socket/room",
      editor: editor as never,
      reconnectInterval: 25,
      onConnected: () => (connected += 1),
      onDisconnected: () => (disconnected += 1),
      onDesynchronized: () => (desynchronized += 1),
      onChangeUsers: (nextUsers) => users.push(nextUsers),
    });

    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0].serverOpen();
    expect(connected).toBe(0);
    FakeWebSocket.instances[0].serverMessage({
      type: "history",
      start: 0,
      operations: [],
    });
    expect(connected).toBe(1);
    expect(users).toEqual([{}]);

    FakeWebSocket.instances[0].serverClose();
    expect(disconnected).toBe(1);
    expect(desynchronized).toBe(0);

    env.runInterval();
    expect(FakeWebSocket.instances).toHaveLength(1);
    env.advance(25);
    env.runInterval();
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.instances[1].serverOpen();
    expect(connected).toBe(1);
    FakeWebSocket.instances[1].serverMessage({
      type: "history",
      start: 0,
      operations: [],
    });
    expect(connected).toBe(2);

    client.dispose();
  });

  test("desynchronizes instead of reconnecting when an unacknowledged edit is dropped", () => {
    installDom();
    const editor = new FakeEditor();
    let disconnected = 0;
    let desynchronized = 0;

    const client = new SyncClient({
      uri: "ws://example.test/api/socket/room",
      editor: editor as never,
      onDisconnected: () => (disconnected += 1),
      onDesynchronized: () => (desynchronized += 1),
    });
    const ws = FakeWebSocket.instances[0];
    ws.serverOpen();

    editor.localInsert(0, "a");
    expect(sentMessages(ws).at(-1)).toEqual({
      type: "edit",
      revision: 0,
      operation: [{ type: "insert", text: "a" }],
    });

    const event = makeBeforeUnloadEvent();
    dispatchWindowEvent(event);
    expect(event.prevented).toBe(true);
    expect(event.returnValue).toBe("");

    ws.serverClose();
    expect(disconnected).toBe(0);
    expect(desynchronized).toBe(1);

    const afterClose = makeBeforeUnloadEvent();
    dispatchWindowEvent(afterClose);
    expect(afterClose.prevented).toBe(true);

    client.dispose();
    const afterDispose = makeBeforeUnloadEvent();
    dispatchWindowEvent(afterDispose);
    expect(afterDispose.prevented).toBe(false);
  });

  test("desynchronizes on incompatible history instead of applying partial state", () => {
    installDom();
    const editor = new FakeEditor();
    let desynchronized = 0;
    const warn = console.warn;
    console.warn = () => {};

    try {
      const client = new SyncClient({
        uri: "ws://example.test/api/socket/room",
        editor: editor as never,
        onDesynchronized: () => (desynchronized += 1),
      });
      const ws = FakeWebSocket.instances[0];
      ws.serverOpen();

      ws.serverMessage({ type: "history", start: 2, operations: [] });

      expect(desynchronized).toBe(1);
      expect(editor.model.getValue()).toBe("");
      client.dispose();
    } finally {
      console.warn = warn;
    }
  });

  test("desynchronizes on malformed server JSON", () => {
    installDom();
    const editor = new FakeEditor();
    let desynchronized = 0;
    const client = new SyncClient({
      uri: "ws://example.test/api/socket/room",
      editor: editor as never,
      onDesynchronized: () => (desynchronized += 1),
    });
    const ws = FakeWebSocket.instances[0];
    ws.serverOpen();

    ws.serverRaw("{");

    expect(desynchronized).toBe(1);
    client.dispose();
  });

  test("keeps retrying with backoff after pre-open connection failures", () => {
    const env = installDom();
    const editor = new FakeEditor();
    let desynchronized = 0;
    const client = new SyncClient({
      uri: "ws://example.test/api/socket/room",
      editor: editor as never,
      reconnectInterval: 10,
      onDesynchronized: () => (desynchronized += 1),
    });

    FakeWebSocket.instances[0].serverClose();
    env.runInterval();
    expect(FakeWebSocket.instances).toHaveLength(1);

    for (let i = 1; i < 7; i += 1) {
      env.advance(Math.min(10 * 2 ** (i - 1), 30_000));
      env.runInterval();
      expect(FakeWebSocket.instances).toHaveLength(i + 1);
      FakeWebSocket.instances[i].serverClose();
    }

    expect(desynchronized).toBe(0);
    expect(FakeWebSocket.instances).toHaveLength(7);
    client.dispose();
  });

  test("desynchronizes when an edit send fails", () => {
    installDom();
    const editor = new FakeEditor();
    let desynchronized = 0;
    const client = new SyncClient({
      uri: "ws://example.test/api/socket/room",
      editor: editor as never,
      onDesynchronized: () => (desynchronized += 1),
    });
    const ws = FakeWebSocket.instances[0];
    ws.serverOpen();
    ws.throwOnSend = true;

    editor.localInsert(0, "a");

    expect(desynchronized).toBe(1);
    client.dispose();
  });

  test("ignores failed presence and cursor sends", () => {
    installDom();
    const editor = new FakeEditor();
    let desynchronized = 0;
    const client = new SyncClient({
      uri: "ws://example.test/api/socket/room",
      editor: editor as never,
      onDesynchronized: () => (desynchronized += 1),
    });
    const ws = FakeWebSocket.instances[0];
    ws.serverOpen();
    ws.throwOnSend = true;

    expect(() => client.setInfo({ name: "Ada", hue: 120 })).not.toThrow();
    expect(() =>
      (
        client as unknown as {
          sendCursorData(): void;
        }
      ).sendCursorData(),
    ).not.toThrow();
    expect(desynchronized).toBe(0);

    client.dispose();
  });
});

describe("SyncClient collaborative editing", () => {
  test("applies remote edits outside the local undo stack", () => {
    installDom();
    const editor = new FakeEditor();
    const client = new SyncClient({
      uri: "ws://example.test/api/socket/room",
      editor: editor as never,
    });
    const ws = FakeWebSocket.instances[0];
    ws.serverOpen();
    ws.serverMessage({ type: "identity", id: 1 });

    ws.serverMessage({
      type: "history",
      start: 0,
      operations: [{ id: 2, operation: [{ type: "insert", text: "abc" }] }],
    });
    ws.serverMessage({
      type: "history",
      start: 1,
      operations: [
        {
          id: 2,
          operation: [
            { type: "delete", count: 1 },
            { type: "retain", count: 2 },
          ],
        },
      ],
    });

    expect(editor.model.getValue()).toBe("bc");
    expect(editor.model.applyEditsUndoFlags).toEqual([false, false]);

    client.dispose();
  });

  test("transforms outstanding and buffered local edits across a concurrent remote edit", () => {
    installDom();
    const editor = new FakeEditor();
    const client = new SyncClient({
      uri: "ws://example.test/api/socket/room",
      editor: editor as never,
    });
    const ws = FakeWebSocket.instances[0];
    ws.serverOpen();
    ws.serverMessage({ type: "identity", id: 1 });
    ws.serverMessage({
      type: "history",
      start: 0,
      operations: [{ id: 2, operation: [{ type: "insert", text: "abc" }] }],
    });
    ws.sent = [];

    editor.localInsert(3, "X");
    editor.localInsert(4, "Y");

    expect(sentMessages(ws)).toEqual([
      {
        type: "edit",
        revision: 1,
        operation: [
          { type: "retain", count: 3 },
          { type: "insert", text: "X" },
        ],
      },
    ]);

    ws.serverMessage({
      type: "history",
      start: 1,
      operations: [
        {
          id: 2,
          operation: [
            { type: "insert", text: "Z" },
            { type: "retain", count: 3 },
          ],
        },
      ],
    });

    expect(editor.model.getValue()).toBe("ZabcXY");
    expect(ws.sent).toHaveLength(1);

    ws.serverMessage({
      type: "history",
      start: 2,
      operations: [
        {
          id: 1,
          operation: [
            { type: "retain", count: 4 },
            { type: "insert", text: "X" },
          ],
        },
      ],
    });

    expect(sentMessages(ws).at(-1)).toEqual({
      type: "edit",
      revision: 3,
      operation: [
        { type: "retain", count: 5 },
        { type: "insert", text: "Y" },
      ],
    });

    client.dispose();
  });

  test("flushes cursor state deferred behind a buffered edit", () => {
    installDom();
    const editor = new FakeEditor();
    const client = new SyncClient({
      uri: "ws://example.test/api/socket/room",
      editor: editor as never,
    });
    const ws = FakeWebSocket.instances[0];
    ws.serverOpen();
    ws.serverMessage({ type: "identity", id: 1 });
    ws.serverMessage({ type: "history", start: 0, operations: [] });
    ws.sent = [];

    editor.localInsert(0, "a");
    editor.localInsert(1, "b");
    Object.assign(client as unknown as { cursorData: unknown }, {
      cursorData: { cursors: [2], selections: [[0, 2]] },
    });
    (
      client as unknown as {
        sendCursorData(): void;
      }
    ).sendCursorData();

    expect(sentMessages(ws).filter(isCursorMessage)).toEqual([]);
    ws.serverMessage({
      type: "history",
      start: 0,
      operations: [{ id: 1, operation: [{ type: "insert", text: "a" }] }],
    });

    expect(sentMessages(ws).filter(isCursorMessage)).toEqual([
      {
        type: "cursorData",
        data: { cursors: [2], selections: [[0, 2]] },
      },
    ]);
    client.dispose();
  });

  test("transforms undo through later remote edits", () => {
    installDom();
    const editor = new FakeEditor();
    const client = new SyncClient({
      uri: "ws://example.test/api/socket/room",
      editor: editor as never,
    });
    const ws = FakeWebSocket.instances[0];
    ws.serverOpen();
    ws.serverMessage({ type: "identity", id: 1 });
    ws.serverMessage({
      type: "history",
      start: 0,
      operations: [{ id: 2, operation: [{ type: "insert", text: "ab" }] }],
    });

    editor.localInsert(2, "X");
    ws.serverMessage({
      type: "history",
      start: 1,
      operations: [
        {
          id: 1,
          operation: [
            { type: "retain", count: 2 },
            { type: "insert", text: "X" },
          ],
        },
      ],
    });
    ws.serverMessage({
      type: "history",
      start: 2,
      operations: [
        {
          id: 2,
          operation: [
            { type: "insert", text: "Z" },
            { type: "retain", count: 3 },
          ],
        },
      ],
    });

    editor.keyDown({ metaKey: true, keyCode: MONACO_KEY_CODE_Z });

    expect(editor.model.getValue()).toBe("Zab");
    expect(sentMessages(ws).at(-1)).toEqual({
      type: "edit",
      revision: 3,
      operation: [
        { type: "retain", count: 3 },
        { type: "delete", count: 1 },
      ],
    });

    ws.serverMessage({
      type: "history",
      start: 3,
      operations: [
        {
          id: 1,
          operation: [
            { type: "retain", count: 3 },
            { type: "delete", count: 1 },
          ],
        },
      ],
    });
    editor.keyDown({ metaKey: true, shiftKey: true, keyCode: MONACO_KEY_CODE_Z });

    expect(editor.model.getValue()).toBe("ZabX");
    expect(sentMessages(ws).at(-1)).toEqual({
      type: "edit",
      revision: 4,
      operation: [
        { type: "retain", count: 3 },
        { type: "insert", text: "X" },
      ],
    });

    client.dispose();
  });

  test("keeps undo history when deleting a previous local insert", () => {
    installDom();
    const editor = new FakeEditor();
    const client = new SyncClient({
      uri: "ws://example.test/api/socket/room",
      editor: editor as never,
    });
    const ws = FakeWebSocket.instances[0];
    ws.serverOpen();
    ws.serverMessage({ type: "identity", id: 1 });

    editor.localInsert(0, "a");
    editor.localInsert(0, "b");
    editor.localDelete(0, 1);

    editor.keyDown({ metaKey: true, keyCode: MONACO_KEY_CODE_Z });
    editor.keyDown({ metaKey: true, keyCode: MONACO_KEY_CODE_Z });
    editor.keyDown({ metaKey: true, keyCode: MONACO_KEY_CODE_Z });

    expect(editor.model.getValue()).toBe("");

    client.dispose();
  });

  test("groups consecutive typing and exposes undo and redo as editor actions", () => {
    installDom();
    const editor = new FakeEditor();
    const client = new SyncClient({
      uri: "ws://example.test/api/socket/room",
      editor: editor as never,
    });
    const ws = FakeWebSocket.instances[0];
    ws.serverOpen();
    ws.serverMessage({ type: "identity", id: 1 });

    editor.localInsert(0, "a");
    editor.localInsert(1, "b");
    editor.localInsert(2, "c");
    editor.runAction("crustpad.undo");
    expect(editor.model.getValue()).toBe("");
    editor.model.redo();
    expect(editor.model.getValue()).toBe("abc");
    editor.model.undo();
    expect(editor.model.getValue()).toBe("");
    editor.runAction("crustpad.redo");
    expect(editor.model.getValue()).toBe("abc");

    client.dispose();
  });

  test("converges through seeded concurrent edits with undo and redo", () => {
    installDom();
    const editor = new FakeEditor();
    const client = new SyncClient({
      uri: "ws://example.test/api/socket/room",
      editor: editor as never,
    });
    const ws = FakeWebSocket.instances[0];
    ws.serverOpen();
    ws.serverMessage({ type: "identity", id: 1 });
    ws.serverMessage({ type: "history", start: 0, operations: [] });

    let seed = 7;
    let revision = 0;
    let serverText = "";
    const random = () => (seed = (seed * 48271) % 0x7fffffff) / 0x7fffffff;
    const acknowledgeLatestEdit = () => {
      const message = sentMessages(ws).filter(isEditMessage).at(-1);
      if (!message) {
        throw new Error("missing edit");
      }
      serverText = apply(serverText, message.operation);
      ws.serverMessage({
        type: "history",
        start: revision,
        operations: [{ id: 1, operation: message.operation }],
      });
      revision += 1;
    };

    for (let index = 0; index < 20; index += 1) {
      const localOffset = Math.floor(random() * (serverText.length + 1));
      editor.localInsert(localOffset, String.fromCharCode(97 + (index % 26)));
      const local = sentMessages(ws).filter(isEditMessage).at(-1);
      if (!local) {
        throw new Error("missing local edit");
      }

      const remoteOffset = Math.floor(random() * (serverText.length + 1));
      const remote = insertOperation(serverText.length, remoteOffset, "R");
      const [localPrime] = transform(local.operation, remote);
      serverText = apply(apply(serverText, remote), localPrime);
      ws.serverMessage({
        type: "history",
        start: revision,
        operations: [{ id: 2, operation: remote }],
      });
      revision += 1;
      ws.serverMessage({
        type: "history",
        start: revision,
        operations: [{ id: 1, operation: localPrime }],
      });
      revision += 1;
      expect(editor.model.getValue()).toBe(serverText);

      if (index % 4 === 3) {
        editor.runAction("crustpad.undo");
        acknowledgeLatestEdit();
        expect(editor.model.getValue()).toBe(serverText);
        editor.runAction("crustpad.redo");
        acknowledgeLatestEdit();
        expect(editor.model.getValue()).toBe(serverText);
      }
    }

    client.dispose();
  });
});

function installDom() {
  const target = globalThis as unknown as GlobalWithFakes;
  const originalDocument = target.document;
  const originalWindow = target.window;
  const originalWebSocket = target.WebSocket;
  const intervals = new Map<number, () => void>();
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const originalDateNow = Date.now;
  const originalRandom = Math.random;
  let nextIntervalId = 1;
  let now = 1_000;

  FakeWebSocket.instances = [];
  Date.now = () => now;
  Math.random = () => 0;
  target.WebSocket = FakeWebSocket;
  target.document = {
    createElement() {
      return { appendChild() {} };
    },
    createTextNode(text: string) {
      return text;
    },
    head: {
      appendChild() {},
    },
  };
  target.window = {
    addEventListener(type: string, listener: (event: unknown) => void) {
      const existing = listeners.get(type) ?? new Set();
      existing.add(listener);
      listeners.set(type, existing);
    },
    clearInterval(id: number) {
      intervals.delete(id);
    },
    dispatchEvent(event: { type: string }) {
      for (const listener of listeners.get(event.type) ?? []) {
        listener(event);
      }
    },
    removeEventListener(type: string, listener: (event: unknown) => void) {
      listeners.get(type)?.delete(listener);
    },
    setInterval(callback: () => void) {
      const id = nextIntervalId++;
      intervals.set(id, callback);
      return id;
    },
  };

  cleanupDom = () => {
    target.document = originalDocument;
    target.window = originalWindow;
    target.WebSocket = originalWebSocket;
    Date.now = originalDateNow;
    Math.random = originalRandom;
  };

  return {
    advance(ms: number) {
      now += ms;
    },
    runInterval(index = 0) {
      const callback = Array.from(intervals.values())[index];
      if (!callback) {
        throw new Error(`missing interval ${index}`);
      }
      callback();
    },
  };
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  sent: string[] = [];
  throwOnSend = false;

  constructor(readonly uri: string) {
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    this.onclose?.();
  }

  send(message: string): void {
    if (this.throwOnSend) {
      throw new Error("send failed");
    }
    this.sent.push(message);
  }

  serverClose(): void {
    this.onclose?.();
  }

  serverMessage(message: ServerMsg): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  serverRaw(data: string): void {
    this.onmessage?.({ data });
  }

  serverOpen(): void {
    this.onopen?.();
  }
}

class FakeEditor {
  readonly model = new FakeModel();
  private readonly actions = new Map<string, () => void>();
  private readonly changeListeners = new Set<(event: { changes: Change[] }) => void>();
  private readonly cursorListeners = new Set<(event: unknown) => void>();
  private readonly selectionListeners = new Set<(event: unknown) => void>();

  getModel(): FakeModel {
    return this.model;
  }

  localInsert(offset: number, text: string): void {
    this.localChange({ rangeOffset: offset, rangeLength: 0, text });
  }

  localDelete(offset: number, length: number): void {
    this.localChange({ rangeOffset: offset, rangeLength: length, text: "" });
  }

  keyDown(event: Partial<FakeKeyEvent>): void {
    const keyEvent = {
      ctrlKey: false,
      keyCode: 0,
      metaKey: false,
      shiftKey: false,
      ...event,
    };
    if ((keyEvent.ctrlKey || keyEvent.metaKey) && keyEvent.keyCode === 56) {
      this.runAction(keyEvent.shiftKey ? "crustpad.redo" : "crustpad.undo");
    }
  }

  addAction(action: { id: string; run: () => void }) {
    this.actions.set(action.id, action.run);
    return disposable(() => this.actions.delete(action.id));
  }

  runAction(id: string): void {
    this.actions.get(id)?.();
  }

  onDidChangeCursorPosition(listener: (event: unknown) => void) {
    this.cursorListeners.add(listener);
    return disposable(() => this.cursorListeners.delete(listener));
  }

  onDidChangeCursorSelection(listener: (event: unknown) => void) {
    this.selectionListeners.add(listener);
    return disposable(() => this.selectionListeners.delete(listener));
  }

  onDidChangeModelContent(listener: (event: { changes: Change[] }) => void) {
    this.changeListeners.add(listener);
    return disposable(() => this.changeListeners.delete(listener));
  }

  private localChange(change: Change): void {
    this.model.replace(change.rangeOffset, change.rangeLength, change.text);
    for (const listener of this.changeListeners) {
      listener({ changes: [change] });
    }
  }
}

type FakeKeyEvent = {
  ctrlKey: boolean;
  keyCode: number;
  metaKey: boolean;
  shiftKey: boolean;
};

class FakeModel {
  applyEditsUndoFlags: unknown[] = [];
  private text = "";

  undo(): void {}

  redo(): void {}

  applyEdits(
    edits: Array<{
      range: {
        startLineNumber: number;
        startColumn: number;
        endLineNumber: number;
        endColumn: number;
      };
      text: string;
    }>,
    computeUndoEdits?: boolean,
  ): void {
    this.applyEditsUndoFlags.push(computeUndoEdits);
    for (const edit of [...edits].sort(
      (a, b) => b.range.startColumn - a.range.startColumn,
    )) {
      const start = this.getOffsetAt({
        column: edit.range.startColumn,
      });
      const end = this.getOffsetAt({
        column: edit.range.endColumn,
      });
      this.text = this.text.slice(0, start) + edit.text + this.text.slice(end);
    }
  }

  deltaDecorations(_oldDecorations: string[], decorations: unknown[]): string[] {
    return decorations.map((_, index) => `decoration-${index}`);
  }

  getOffsetAt(position: { column: number }): number {
    return position.column - 1;
  }

  getPositionAt(offset: number): { lineNumber: number; column: number } {
    return { lineNumber: 1, column: offset + 1 };
  }

  getValue(): string {
    return this.text;
  }

  replace(offset: number, length: number, text: string): void {
    this.text = this.text.slice(0, offset) + text + this.text.slice(offset + length);
  }
}

function disposable(dispose: () => void) {
  return { dispose };
}

function makeBeforeUnloadEvent() {
  return {
    type: "beforeunload",
    prevented: false,
    returnValue: undefined as string | undefined,
    preventDefault() {
      this.prevented = true;
    },
  };
}

function dispatchWindowEvent(event: unknown): void {
  (window as unknown as { dispatchEvent: (event: unknown) => void }).dispatchEvent(
    event,
  );
}

function sentMessages(ws: FakeWebSocket): unknown[] {
  return ws.sent.map((message) => JSON.parse(message));
}

function isCursorMessage(
  message: unknown,
): message is { type: "cursorData"; data: unknown } {
  return (message as { type?: string }).type === "cursorData";
}

function isEditMessage(
  message: unknown,
): message is { type: "edit"; revision: number; operation: OperationSeq } {
  return (message as { type?: string }).type === "edit";
}

function insertOperation(length: number, offset: number, text: string): OperationSeq {
  return [
    ...(offset ? [{ type: "retain" as const, count: offset }] : []),
    { type: "insert", text },
    ...(length - offset
      ? [{ type: "retain" as const, count: length - offset }]
      : []),
  ];
}
