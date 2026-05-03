import { Room, type SocketData } from "./room";

const port = Number.parseInt(process.env.PORT ?? "3030", 10);
const expiryDays = Number.parseInt(process.env.EXPIRY_DAYS ?? "1", 10);
const startTime = Math.floor(Date.now() / 1000);
const rooms = new Map<string, Room>();

function getRoom(id: string): Room {
  const existing = rooms.get(id);
  if (existing) {
    existing.lastAccessedAt = Date.now();
    return existing;
  }

  const room = new Room(id);
  rooms.set(id, room);
  return room;
}

setInterval(
  () => {
    const cutoff = Date.now() - expiryDays * 24 * 60 * 60 * 1_000;
    for (const [id, room] of rooms) {
      if (room.lastAccessedAt >= cutoff) {
        continue;
      }

      rooms.delete(id);
    }
  },
  60 * 60 * 1_000,
).unref();

const server = Bun.serve<SocketData>({
  port,
  fetch(request, server) {
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
      });
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
