import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useState } from "react";
import {
  VscChevronRight,
  VscFolderOpened,
  VscGist,
  VscRemote,
} from "react-icons/vsc";
import useLocalStorageState from "use-local-storage-state";
import { ProfilePopover } from "./ProfilePopover";
import { Sidebar } from "./Sidebar";
import type { LanguageId } from "./protocol";
import syncClientSource from "./syncClient.ts?raw";
import { useRoomId } from "./useRoomId";
import { useStoredUser } from "./userStorage";
import { useSyncSession } from "./useSyncSession";

function tabSizeForLanguage(language: LanguageId): number {
  switch (language) {
    case "javascript":
    case "typescript":
      return 2;
    case "python":
    case "plaintext":
      return 4;
  }
}

export default function App() {
  const roomId = useRoomId();
  const [editorInstance, setEditorInstance] =
    useState<editor.IStandaloneCodeEditor>();
  const [darkMode, setDarkMode] = useLocalStorageState("darkMode", {
    defaultValue: false,
  });
  const [user, setUser] = useStoredUser();
  const [editingMe, setEditingMe] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftHue, setDraftHue] = useState(0);
  const { connection, language, users, setLanguage } = useSyncSession(
    editorInstance,
    roomId,
    user,
  );

  const handleMount: OnMount = (mountedEditor) => {
    setEditorInstance(mountedEditor);
  };

  const handleLoadSource = () => {
    const model = editorInstance?.getModel();
    if (connection !== "connected" || !editorInstance || !model) {
      return;
    }

    model.pushEditOperations(
      editorInstance.getSelections(),
      [{ range: model.getFullModelRange(), text: syncClientSource }],
      () => null,
    );
    editorInstance.setPosition({ lineNumber: 1, column: 1 });
    setLanguage("typescript");
  };

  const openProfileEditor = () => {
    setDraftName(user.name);
    setDraftHue(user.hue);
    setEditingMe(true);
  };

  const commitProfileEditor = () => {
    const nextName = draftName.trim();
    setUser({
      name: nextName.length > 0 ? nextName : user.name,
      hue: draftHue,
    });
    setEditingMe(false);
  };

  return (
    <main className={`rustpad-shell ${darkMode ? "dark" : "light"}`}>
      <div className="rustpad-title">Crustpad</div>
      <div className="workspace">
        <Sidebar
          connection={connection}
          darkMode={darkMode}
          language={language}
          shareHref={window.location.href}
          currentUser={
            editingMe
              ? {
                  name: user.name,
                  hue: draftHue,
                }
              : user
          }
          remoteUsers={users}
          onChangeDarkMode={setDarkMode}
          onChangeLanguage={setLanguage}
          onEditUser={openProfileEditor}
          onLoadSource={handleLoadSource}
        />

        <section className="main-pane">
          <div className="breadcrumb">
            <VscFolderOpened className="folder-icon" />
            <span>documents</span>
            <VscChevronRight />
            <VscGist className="gist-icon" />
            <span>{roomId}</span>
          </div>
          {connection === "desynchronized" ? (
            <div className="desync">
              This tab fell out of sync with the server. Refresh before editing
              more.
            </div>
          ) : null}
          <div className="editor-frame">
            <Editor
              theme={darkMode ? "vs-dark" : "vs"}
              language={language}
              options={{
                automaticLayout: true,
                fontSize: 13,
                detectIndentation: false,
                insertSpaces: true,
                minimap: { enabled: false },
                readOnly: connection !== "connected",
                scrollBeyondLastLine: false,
                wordWrap: "on",
                tabSize: tabSizeForLanguage(language),
              }}
              onMount={handleMount}
            />
          </div>
        </section>
      </div>
      <Footer />
      {editingMe ? (
        <ProfilePopover
          draftName={draftName}
          draftHue={draftHue}
          onChangeName={setDraftName}
          onChangeHue={setDraftHue}
          onCommit={commitProfileEditor}
        />
      ) : null}
    </main>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-badge">
        <VscRemote />
        <span>Crustpad (development)</span>
      </div>
    </footer>
  );
}
