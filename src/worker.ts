import { DurableObject } from "cloudflare:workers";
import type { OperationSeq } from "./ot";
import type {
  CursorData,
  PersistedDocument,
  UserInfo,
  UserOperation,
} from "./protocol";
import { Room, type RoomPersistenceState, type RoomSocket } from "./room";

type Env = {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace<RoomObject>;
  EXPIRY_DAYS?: string;
};

type SocketAttachment = {
  roomId: string;
  userId?: number;
  info?: UserInfo;
  cursor?: CursorData;
};

type PersistedRoomState = {
  document?: PersistedDocument;
  operations?: UserOperation[];
  lastAccessedAt?: number;
};

const START_TIME = Math.floor(Date.now() / 1000);
const DEFAULT_EXPIRY_DAYS = 1;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    const roomMatch = url.pathname.match(/^\/api\/(socket|text)\/([^/]+)$/);
    if (roomMatch) {
      const roomId = decodeURIComponent(roomMatch[2]);
      const id = env.ROOMS.idFromName(roomId);
      return env.ROOMS.get(id).fetch(request);
    }

    if (url.pathname === "/api/stats") {
      return Response.json({
        startTime: START_TIME,
        numDocuments: null,
        databaseSize: null,
      });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class RoomObject extends DurableObject<Env> {
  private room?: Room;
  private readonly socketWrappers = new WeakMap<WebSocket, CloudflareRoomSocket>();
  private readonly ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = ctx.blockConcurrencyWhile(async () => {
      const persisted = await this.loadRoomState();
      this.room = new Room(this.ctx.id.name ?? this.ctx.id.toString(), persisted.document);
      this.room.beforeHistoryBroadcast = (state) => this.persistRoom(state);
      if (persisted.operations) {
        this.room.restoreOperations(persisted.operations);
      }

      const canRestoreSockets = persisted.operations !== undefined || !persisted.document;
      for (const ws of this.ctx.getWebSockets()) {
        if (!canRestoreSockets) {
          ws.close(1012, "room state changed; reconnect");
          continue;
        }

        const attachment = ws.deserializeAttachment() as SocketAttachment | null;
        const wrapper = this.wrapSocket(ws, attachment);
        this.room.restoreSocket(wrapper, attachment?.info, attachment?.cursor);
      }

      if (persisted.lastAccessedAt !== undefined) {
        this.room.lastAccessedAt = persisted.lastAccessedAt;
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/socket/")) {
      return this.connectSocket(request);
    }

    if (url.pathname.startsWith("/api/text/")) {
      return new Response(this.getRoom().text, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    await this.ready;
    const wrapper = this.wrapSocket(ws);

    try {
      const messageType = await this.getRoom().handle(wrapper, message);
      this.saveAttachment(ws, wrapper);
      if (messageType === "setLanguage") {
        await this.persistRoom();
      } else if (messageType && messageType !== "edit") {
        await this.persistAccess();
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "invalid operation";
      ws.close(1003, reason.slice(0, 123));
      return;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.ready;
    const wrapper = this.wrapSocket(ws);
    this.getRoom().disconnect(wrapper);
    await this.persistAccess();
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  async alarm(): Promise<void> {
    await this.ready;
    const room = this.getRoom();
    const expiryMs = this.expiryDays() * 24 * 60 * 60 * 1_000;
    const cutoff = Date.now() - expiryMs;

    if (room.connectionCount === 0 && room.lastAccessedAt < cutoff) {
      await this.ctx.storage.deleteAll();
      return;
    }

    if (room.connectionCount > 0) {
      room.lastAccessedAt = Date.now();
      await this.persistAccess();
      return;
    }

    await this.scheduleExpiry();
  }

  private connectSocket(request: Request): Response {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const wrapper = this.wrapSocket(server);

    this.ctx.acceptWebSocket(server);
    this.getRoom().connect(wrapper);
    this.saveAttachment(server, wrapper);
    this.ctx.waitUntil(this.persistAccess());

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private getRoom(): Room {
    if (!this.room) {
      throw new Error("Room is not initialized");
    }
    return this.room;
  }

  private wrapSocket(
    ws: WebSocket,
    attachment = ws.deserializeAttachment() as SocketAttachment | null,
  ): CloudflareRoomSocket {
    const existing = this.socketWrappers.get(ws);
    if (existing) {
      return existing;
    }

    const wrapper = new CloudflareRoomSocket(ws, {
      roomId: attachment?.roomId ?? this.ctx.id.name ?? this.ctx.id.toString(),
      userId: attachment?.userId,
    });
    this.socketWrappers.set(ws, wrapper);
    return wrapper;
  }

  private saveAttachment(ws: WebSocket, wrapper: CloudflareRoomSocket): void {
    const userId = wrapper.data.userId;
    const attachment: SocketAttachment = {
      roomId: wrapper.data.roomId,
      userId,
      info: userId === undefined ? undefined : this.getRoom().users.get(userId),
      cursor: userId === undefined ? undefined : this.getRoom().cursors.get(userId),
    };
    ws.serializeAttachment(attachment);
  }

  private async persistRoom(state?: RoomPersistenceState): Promise<void> {
    const room = this.getRoom();
    const nextState = state ?? {
      document: room.snapshot(),
      operations: room.operations,
      lastAccessedAt: room.lastAccessedAt,
    };
    await this.ctx.storage.put({
      document: nextState.document,
      operations: nextState.operations,
      lastAccessedAt: nextState.lastAccessedAt,
    });
    await this.scheduleExpiry();
  }

  private async persistAccess(): Promise<void> {
    await this.ctx.storage.put("lastAccessedAt", this.getRoom().lastAccessedAt);
    await this.scheduleExpiry();
  }

  private async loadRoomState(): Promise<PersistedRoomState> {
    const entries = await this.ctx.storage.get([
      "document",
      "operations",
      "lastAccessedAt",
    ]);
    const document = entries.get("document");
    const operations = entries.get("operations");
    const lastAccessedAt = entries.get("lastAccessedAt");

    return {
      document: isPersistedDocument(document) ? document : undefined,
      operations: isUserOperations(operations) ? operations : undefined,
      lastAccessedAt:
        typeof lastAccessedAt === "number" && Number.isFinite(lastAccessedAt)
          ? lastAccessedAt
          : undefined,
    };
  }

  private async scheduleExpiry(): Promise<void> {
    const expiryMs = this.expiryDays() * 24 * 60 * 60 * 1_000;
    const base = Math.max(this.getRoom().lastAccessedAt, Date.now());
    await this.ctx.storage.setAlarm(base + expiryMs);
  }

  private expiryDays(): number {
    const value = Number.parseInt(this.env.EXPIRY_DAYS ?? "", 10);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_EXPIRY_DAYS;
  }
}

class CloudflareRoomSocket implements RoomSocket {
  constructor(
    private readonly ws: WebSocket,
    readonly data: RoomSocket["data"],
  ) {}

  send(message: string): void {
    this.ws.send(message);
  }

  close(code: number, reason: string): void {
    this.ws.close(code, reason);
  }
}

function isPersistedDocument(value: unknown): value is PersistedDocument {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as PersistedDocument).text === "string" &&
    typeof (value as PersistedDocument).language === "string"
  );
}

function isUserOperations(value: unknown): value is UserOperation[] {
  return Array.isArray(value) && value.every(isUserOperation);
}

function isUserOperation(value: unknown): value is UserOperation {
  if (!value || typeof value !== "object") {
    return false;
  }

  const operation = value as Partial<UserOperation>;
  return (
    Number.isSafeInteger(operation.id) &&
    typeof operation.id === "number" &&
    isOperationSeq(operation.operation)
  );
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
