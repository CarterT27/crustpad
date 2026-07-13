/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { SELF } from "cloudflare:test";
import { describe, expect, test } from "vitest";

describe("Worker room integration", () => {
  test("persists an edit sent over the room WebSocket", async () => {
    const response = await SELF.fetch("https://example.com/api/socket/integration", {
      headers: { Upgrade: "websocket" },
    });
    const socket = response.webSocket;

    expect(response.status).toBe(101);
    expect(socket).not.toBeNull();
    if (!socket) {
      return;
    }

    const acknowledged = new Promise<void>((resolve) => {
      socket.addEventListener("message", (event: MessageEvent) => {
        const message = JSON.parse(String(event.data)) as {
          type?: string;
          operations?: unknown[];
        };
        if (message.type === "history" && message.operations?.length === 1) {
          resolve();
        }
      });
    });

    socket.accept();
    socket.send(
      JSON.stringify({
        type: "edit",
        revision: 0,
        operation: [{ type: "insert", text: "hello" }],
      }),
    );
    await acknowledged;

    const text = await SELF.fetch("https://example.com/api/text/integration");
    expect(await text.text()).toBe("hello");
    socket.close();
  });
});
