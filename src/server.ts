import { DocumentStore } from "./database";
import { Room, type RoomPersistenceState, type SocketData } from "./room";

const port = Number.parseInt(process.env.PORT ?? "3030", 10);
const expiryDays = parseExpiryDays(process.env.EXPIRY_DAYS);
const expiryMs = expiryDays * 24 * 60 * 60 * 1_000;
const persistedAccessTouchInterval = 5 * 60 * 1_000;
const startTime = Math.floor(Date.now() / 1000);
const store = new DocumentStore();
const rooms = new Map<string, Room>();
const persistedAccesses = new Map<string, number>();
const publicDir = new URL("../dist/", import.meta.url);

function getRoom(id: string): Room {
  const now = Date.now();
  const existing = rooms.get(id);
  if (existing) {
    existing.lastAccessedAt = now;
    touchPersistedAccess(id, now);
    return existing;
  }

  const persisted = store.loadRoomState(id);
  if (persisted) {
    store.touch(id, now);
    persistedAccesses.set(id, now);
  }

  const room = new Room(id, persisted?.document);
  if (persisted?.operations) {
    room.restoreOperations(persisted.operations);
  }
  rooms.set(id, room);
  room.beforeStateBroadcast = async (state) => storeRoomState(id, state);
  return room;
}

function touchPersistedAccess(id: string, lastAccessedAt: number): void {
  const lastPersistedAt = persistedAccesses.get(id) ?? 0;
  if (lastAccessedAt - lastPersistedAt < persistedAccessTouchInterval) {
    return;
  }

  store.touch(id, lastAccessedAt);
  persistedAccesses.set(id, lastAccessedAt);
}

function removeRoom(id: string, room: Room): void {
  storeCurrentRoom(id, room);
  persistedAccesses.delete(id);
  rooms.delete(id);
}

function storeRoomState(id: string, state: RoomPersistenceState): void {
  store.storeRoomState(
    id,
    state.document,
    state.operations,
    state.lastAccessedAt,
  );
  persistedAccesses.set(id, state.lastAccessedAt);
}

function storeCurrentRoom(id: string, room: Room): void {
  storeRoomState(id, {
    document: room.snapshot(),
    operations: room.operations,
    lastAccessedAt: room.lastAccessedAt,
  });
}

function expireRoomsAndDocuments(): void {
  const now = Date.now();
  const cutoff = now - expiryMs;
  for (const [id, room] of rooms) {
    if (room.connectionCount > 0) {
      room.lastAccessedAt = now;
      touchPersistedAccess(id, now);
      continue;
    }

    if (room.lastAccessedAt >= cutoff) {
      continue;
    }

    removeRoom(id, room);
  }

  store.deleteExpired(cutoff, Array.from(rooms.keys()));
}

expireRoomsAndDocuments();
setInterval(expireRoomsAndDocuments, 60 * 60 * 1_000).unref();

function parseExpiryDays(value: string | undefined): number {
  const fallback = 1;
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const server = Bun.serve<SocketData>({
  port,
  async fetch(request, server) {
    const url = new URL(request.url);

    const socketMatch = url.pathname.match(/^\/api\/socket\/([^/]+)$/);
    if (socketMatch) {
      const roomId = decodeURIComponent(socketMatch[1]);
      if (server.upgrade(request, { data: { roomId } })) {
        return undefined;
      }
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    const textMatch = url.pathname.match(/^\/api\/text\/([^/]+)$/);
    if (textMatch) {
      const roomId = decodeURIComponent(textMatch[1]);
      return new Response(getRoom(roomId).text, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (url.pathname === "/api/stats") {
      return Response.json({
        startTime,
        numDocuments: rooms.size,
        databaseSize: store.count(),
      });
    }

    const assetResponse = await staticAssetResponse(url.pathname);
    if (assetResponse) {
      return assetResponse;
    }

    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      getRoom(ws.data.roomId).connect(ws);
    },
    async message(ws, message) {
      try {
        await getRoom(ws.data.roomId).handle(ws, message);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "invalid operation";
        ws.close(1003, reason.slice(0, 123));
      }
    },
    close(ws) {
      const room = rooms.get(ws.data.roomId);
      if (!room) {
        return;
      }

      room.disconnect(ws);
      if (room.compactHistory()) {
        storeCurrentRoom(ws.data.roomId, room);
      }
    },
  },
});

console.log(`crustpad listening on http://localhost:${server.port}`);

async function staticAssetResponse(pathname: string): Promise<Response | undefined> {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const path = normalizedPath.startsWith("/assets/")
    ? normalizedPath.slice(1)
    : "index.html";
  const file = Bun.file(new URL(path, publicDir));

  if (!(await file.exists())) {
    return undefined;
  }

  const headers = new Headers();
  const workerCsp = runnerWorkerCsp(path);
  if (workerCsp) {
    headers.set("content-security-policy", workerCsp);
  }

  return new Response(file, { headers });
}

function runnerWorkerCsp(path: string): string | undefined {
  const match = /^assets\/(c|cpp|js|ts)\.worker-[\w-]+\.js$/.exec(path);
  if (!match) {
    return undefined;
  }

  const connectSrc =
    match[1] === "cpp" ? "connect-src 'self' https://cdn.jsdelivr.net" : "connect-src 'self'";

  return [
    "default-src 'none'",
    "script-src 'self' blob: 'wasm-unsafe-eval'",
    connectSrc,
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}
