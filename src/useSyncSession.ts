import type { editor } from "monaco-editor";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LanguageId, UserInfo } from "./protocol";
import { SyncClient } from "./syncClient";

export type Connection = "connected" | "disconnected" | "desynchronized";

type SyncSession = {
  connection: Connection;
  language: LanguageId;
  users: Record<number, UserInfo>;
  setLanguage: (language: LanguageId) => void;
};

function getWsUri(roomId: string): string {
  const url = new URL(`/api/socket/${encodeURIComponent(roomId)}`, window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

export function useSyncSession(
  editorInstance: editor.IStandaloneCodeEditor | undefined,
  roomId: string,
  user: UserInfo,
): SyncSession {
  const [language, setLanguageState] = useState<LanguageId>("plaintext");
  const [connection, setConnection] = useState<Connection>("disconnected");
  const [users, setUsers] = useState<Record<number, UserInfo>>({});
  const syncClient = useRef<SyncClient | undefined>(undefined);
  const userRef = useRef(user);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    const model = editorInstance?.getModel();
    if (!editorInstance || !model) {
      return;
    }

    model.setValue("");
    model.setEOL(0);
    setConnection("disconnected");
    syncClient.current = new SyncClient({
      uri: getWsUri(roomId),
      editor: editorInstance,
      onConnected: () => setConnection("connected"),
      onDisconnected: () => setConnection("disconnected"),
      onDesynchronized: () => setConnection("desynchronized"),
      onChangeLanguage: setLanguageState,
      onChangeUsers: setUsers,
    });
    syncClient.current.setInfo(userRef.current);

    return () => {
      syncClient.current?.dispose();
      syncClient.current = undefined;
      setUsers({});
    };
  }, [editorInstance, roomId]);

  useEffect(() => {
    if (connection === "connected") {
      syncClient.current?.setInfo(user);
    }
  }, [connection, user]);

  const setLanguage = useCallback((nextLanguage: LanguageId) => {
    setLanguageState(nextLanguage);
    syncClient.current?.setLanguage(nextLanguage);
  }, []);

  return {
    connection,
    language,
    users,
    setLanguage,
  };
}
