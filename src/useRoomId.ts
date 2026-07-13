import { useEffect, useState } from "react";

function generateRoomId(): string {
  return crypto.randomUUID().replaceAll("-", "");
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

const initialRoomId = currentRoomId();

export function useRoomId(): string {
  const [roomId, setRoomId] = useState(initialRoomId);

  useEffect(() => {
    const onPopState = () => setRoomId(currentRoomId());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return roomId;
}
