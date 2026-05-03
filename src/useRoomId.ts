import { useEffect, useState } from "react";

const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const idLength = 6;

function generateRoomId(): string {
  let id = "";
  for (let i = 0; i < idLength; i += 1) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function currentRoomId(): string {
  const match = window.location.pathname.match(/^\/r\/([^/]+)$/);
  if (match) {
    return decodeURIComponent(match[1]);
  }

  const id = generateRoomId();
  window.history.replaceState(null, "", `/r/${encodeURIComponent(id)}`);
  return id;
}

export function useRoomId(): string {
  const [roomId, setRoomId] = useState(currentRoomId);

  useEffect(() => {
    const onPopState = () => setRoomId(currentRoomId());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return roomId;
}
