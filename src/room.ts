import { apply, normalize, targetLength, transform, transformIndex } from "./ot";
import type { OperationSeq } from "./ot";
import type {
  ClientMsg,
  CursorData,
  LanguageId,
  PersistedDocument,
  ServerMsg,
  UserId,
  UserInfo,
  UserOperation,
} from "./protocol";
import { isLanguageId } from "./protocol";

export type SocketData = {
  roomId: string;
  userId?: UserId;
};

export type RoomSocket = {
  data: SocketData;
  send(message: string): void;
  close(code: number, reason: string): void;
};

export type RoomPersistenceState = {
  document: PersistedDocument;
  operations: UserOperation[];
  lastAccessedAt: number;
};

const MAX_TARGET_LENGTH = 256 * 1024;
const MAX_USER_NAME_LENGTH = 25;
const MIN_USER_HUE = 0;
const MAX_USER_HUE = 359;
const MAX_CURSORS = 16;
const MAX_SELECTIONS = 16;

export class Room {
  readonly id: string;
  text = "";
  language: LanguageId = "plaintext";
  revision = 0;
  operations: UserOperation[] = [];
  users = new Map<UserId, UserInfo>();
  cursors = new Map<UserId, CursorData>();
  lastAccessedAt = Date.now();
  beforeHistoryBroadcast?: (state: RoomPersistenceState) => Promise<void>;

  private nextUserId = 0;
  private readonly sockets = new Set<RoomSocket>();

  constructor(id: string, persisted?: PersistedDocument) {
    this.id = id;
    if (persisted) {
      this.text = persisted.text;
      this.language = persisted.language;
      const operation = normalize([{ type: "insert", text: persisted.text }]);
      this.operations.push({ id: Number.MAX_SAFE_INTEGER, operation });
      this.revision = this.operations.length;
    }
  }

  get connectionCount(): number {
    return this.sockets.size;
  }

  connect(ws: RoomSocket): void {
    const userId = this.nextUserId++;
    ws.data.userId = userId;
    this.sockets.add(ws);
    this.restoreUserId(userId);
    this.touch();

    this.send(ws, { type: "identity", id: userId });
    this.send(ws, {
      type: "history",
      start: 0,
      operations: this.operations,
    });
    this.send(ws, { type: "language", language: this.language });
    for (const [id, info] of this.users) {
      this.send(ws, { type: "userInfo", id, info });
    }
    for (const [id, data] of this.cursors) {
      this.send(ws, { type: "userCursor", id, data });
    }
  }

  disconnect(ws: RoomSocket): void {
    this.sockets.delete(ws);
    const userId = ws.data.userId;
    if (userId === undefined) {
      return;
    }

    this.users.delete(userId);
    this.cursors.delete(userId);
    this.broadcast({ type: "userInfo", id: userId, info: null });
    this.touch();
  }

  restoreSocket(ws: RoomSocket, info?: UserInfo, cursor?: CursorData): void {
    const userId = ws.data.userId;
    if (userId === undefined) {
      return;
    }

    this.sockets.add(ws);
    this.restoreUserId(userId);
    if (info) {
      this.users.set(userId, info);
    }
    if (cursor) {
      this.cursors.set(userId, cursor);
    }
    this.touch();
  }

  async handle(ws: RoomSocket, raw: unknown): Promise<ClientMsg["type"] | undefined> {
    const userId = ws.data.userId;
    if (userId === undefined || typeof raw !== "string") {
      return undefined;
    }

    const message = parseClientMsg(raw, Array.from(this.text).length);
    if (!message) {
      ws.close(1003, "invalid message");
      return undefined;
    }

    this.touch();
    switch (message.type) {
      case "edit":
        await this.applyEdit(userId, message.revision, message.operation);
        break;
      case "setLanguage":
        this.language = message.language;
        this.broadcast({ type: "language", language: message.language });
        break;
      case "clientInfo":
        this.users.set(userId, message.info);
        this.broadcast({ type: "userInfo", id: userId, info: message.info });
        break;
      case "cursorData":
        this.cursors.set(userId, message.data);
        this.broadcast({ type: "userCursor", id: userId, data: message.data });
        break;
    }
    return message.type;
  }

  snapshot(): PersistedDocument {
    return {
      text: this.text,
      language: this.language,
    };
  }

  restoreOperations(operations: UserOperation[]): void {
    this.operations = operations;
    this.revision = operations.length;
    for (const { id } of operations) {
      this.restoreUserId(id);
    }
  }

  private async applyEdit(
    userId: UserId,
    revision: number,
    incoming: UserOperation["operation"],
  ): Promise<void> {
    if (!Number.isSafeInteger(revision) || revision < 0 || revision > this.revision) {
      throw new Error(`invalid revision ${revision}`);
    }

    let operation = normalize(incoming);
    for (const historyOp of this.operations.slice(revision)) {
      operation = transform(operation, historyOp.operation)[0];
    }

    if (targetLength(operation) > MAX_TARGET_LENGTH) {
      throw new Error("document exceeds maximum length");
    }

    const nextText = apply(this.text, operation);
    const nextCursors = new Map<UserId, CursorData>();
    for (const [id, data] of this.cursors) {
      nextCursors.set(id, transformCursorData(data, operation));
    }

    const userOperation = { id: userId, operation };
    const nextOperations = [...this.operations, userOperation];
    const nextRevision = nextOperations.length;
    await this.beforeHistoryBroadcast?.({
      document: { text: nextText, language: this.language },
      operations: nextOperations,
      lastAccessedAt: this.lastAccessedAt,
    });

    this.operations = nextOperations;
    this.revision = nextRevision;
    this.text = nextText;
    this.cursors = nextCursors;
    this.broadcast({
      type: "history",
      start: nextRevision - 1,
      operations: [userOperation],
    });
  }

  private broadcast(message: ServerMsg): void {
    for (const socket of this.sockets) {
      this.send(socket, message);
    }
  }

  private send(ws: RoomSocket, message: ServerMsg): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      this.dropSocket(ws);
    }
  }

  private dropSocket(ws: RoomSocket): void {
    const hadSocket = this.sockets.delete(ws);
    const userId = ws.data.userId;
    if (userId === undefined) {
      return;
    }

    const hadUser = this.users.delete(userId);
    const hadCursor = this.cursors.delete(userId);
    const hadPresence = hadUser || hadCursor;
    if (hadSocket || hadPresence) {
      this.broadcast({ type: "userInfo", id: userId, info: null });
    }
  }

  private restoreUserId(userId: UserId): void {
    if (
      !Number.isSafeInteger(userId) ||
      userId < 0 ||
      userId >= Number.MAX_SAFE_INTEGER
    ) {
      return;
    }

    this.nextUserId = Math.max(this.nextUserId, userId + 1);
  }

  private touch(): void {
    this.lastAccessedAt = Date.now();
  }
}

function transformCursorData(
  data: CursorData,
  operation: OperationSeq,
): CursorData {
  return {
    cursors: data.cursors.map((cursor) => transformIndex(operation, cursor)),
    selections: data.selections.map(([start, end]) => [
      transformIndex(operation, start),
      transformIndex(operation, end),
    ]),
  };
}

function parseClientMsg(raw: string, documentLength: number): ClientMsg | undefined {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || !("type" in value)) {
    return undefined;
  }

  const message = value as ClientMsg;
  switch (message.type) {
    case "edit":
      if (
        Number.isSafeInteger(message.revision) &&
        isOperationSeq(message.operation)
      ) {
        return message;
      }
      return undefined;
    case "setLanguage":
      return isLanguageId(message.language) ? message : undefined;
    case "clientInfo":
      return isUserInfo(message.info) ? message : undefined;
    case "cursorData":
      return isCursorData(message.data, documentLength) ? message : undefined;
    default:
      return undefined;
  }
}

function isOperationSeq(value: unknown): value is OperationSeq {
  return Array.isArray(value) && value.every(isOperationComponent);
}

function isOperationComponent(value: unknown): value is OperationSeq[number] {
  if (!value || typeof value !== "object") {
    return false;
  }

  const component = value as Partial<OperationSeq[number]>;
  switch (component.type) {
    case "retain":
    case "delete":
      return (
        Number.isSafeInteger(component.count) &&
        typeof component.count === "number" &&
        component.count >= 0
      );
    case "insert":
      return typeof component.text === "string";
    default:
      return false;
  }
}

function isUserInfo(value: unknown): value is UserInfo {
  if (!value || typeof value !== "object") {
    return false;
  }

  const { name, hue } = value as Partial<UserInfo>;
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= MAX_USER_NAME_LENGTH &&
    isUserHue(hue)
  );
}

function isUserHue(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    typeof value === "number" &&
    value >= MIN_USER_HUE &&
    value <= MAX_USER_HUE
  );
}

function isDocumentOffset(value: unknown, documentLength: number): value is number {
  return (
    Number.isSafeInteger(value) &&
    typeof value === "number" &&
    value >= 0 &&
    value <= documentLength
  );
}

function isCursorData(value: unknown, documentLength: number): value is CursorData {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as CursorData).cursors) &&
    (value as CursorData).cursors.length <= MAX_CURSORS &&
    (value as CursorData).cursors.every((cursor) =>
      isDocumentOffset(cursor, documentLength),
    ) &&
    Array.isArray((value as CursorData).selections) &&
    (value as CursorData).selections.length <= MAX_SELECTIONS &&
    (value as CursorData).selections.every(
      (selection) =>
        Array.isArray(selection) &&
        selection.length === 2 &&
        selection.every((offset) => isDocumentOffset(offset, documentLength)),
    )
  );
}
