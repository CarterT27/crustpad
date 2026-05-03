import { DocumentStore } from "./database";
import { Room, type SocketData } from "./room";

const port = Number.parseInt(process.env.PORT ?? "3030", 10);
const expiryDays = Number.parseInt(process.env.EXPIRY_DAYS ?? "1", 10);
const startTime = Math.floor(Date.now() / 1000);
const store = new DocumentStore();
const rooms = new Map<string, Room>();
const persisters = new Map<string, Timer>();
const publicDir = new URL("../dist/", import.meta.url);

function getRoom(id: string): Room {
  const existing = rooms.get(id);
  if (existing) {
    existing.lastAccessedAt = Date.now();
    return existing;
  }

  const room = new Room(id, store.load(id));
  rooms.set(id, room);
  startPersister(id, room);
  return room;
}

function startPersister(id: string, room: Room): void {
  let lastRevision = room.revision;
  const timer = setInterval(() => {
    if (room.revision <= lastRevision) {
      return;
    }

    store.store(id, room.snapshot());
    lastRevision = room.revision;
  }, 3_000);
  timer.unref();
  persisters.set(id, timer);
}

function removeRoom(id: string, room: Room): void {
  store.store(id, room.snapshot());
  rooms.delete(id);
  const timer = persisters.get(id);
  if (timer) {
    clearInterval(timer);
    persisters.delete(id);
  }
}

setInterval(
  () => {
    const cutoff = Date.now() - expiryDays * 24 * 60 * 60 * 1_000;
    for (const [id, room] of rooms) {
      if (room.lastAccessedAt >= cutoff) {
        continue;
      }

      removeRoom(id, room);
    }
  },
  60 * 60 * 1_000,
).unref();

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
    message(ws, message) {
      try {
        getRoom(ws.data.roomId).handle(ws, message);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "invalid operation";
        ws.close(1003, reason.slice(0, 123));
      }
    },
    close(ws) {
      rooms.get(ws.data.roomId)?.disconnect(ws);
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
  if (isJavaScriptRunnerWorker(path)) {
    headers.set(
      "content-security-policy",
      [
        "default-src 'none'",
        "script-src 'self' blob: 'wasm-unsafe-eval'",
        "connect-src 'self'",
        "worker-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join("; "),
    );
  }

  return new Response(file, { headers });
}

function isJavaScriptRunnerWorker(path: string): boolean {
  return /^assets\/(?:js|ts)\.worker-[\w-]+\.js$/.test(path);
}
