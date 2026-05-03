import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useRef, useState } from "react";
import {
  VscChevronRight,
  VscFolderOpened,
  VscGist,
  VscRemote,
} from "react-icons/vsc";
import useLocalStorageState from "use-local-storage-state";
import { ProfilePopover } from "./ProfilePopover";
import { OutputPanel, type RunPanelState } from "./OutputPanel";
import { Sidebar } from "./Sidebar";
import type { LanguageId } from "./protocol";
import { canRunLanguage, runCode } from "./runner/run";
import syncClientSource from "./syncClient.ts?raw";
import { useRoomId } from "./useRoomId";
import { useStoredUser } from "./userStorage";
import { useSyncSession } from "./useSyncSession";

function tabSizeForLanguage(language: LanguageId): number {
  switch (language) {
    case "c":
    case "cpp":
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
  const [runResult, setRunResult] = useState<RunPanelState>({
    status: "idle",
    language: "plaintext",
  });
  const runCounter = useRef(0);
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

  const handleDownload = () => {
    const value = editorInstance?.getModel()?.getValue();
    if (value === undefined) {
      return;
    }

    const extension = {
      c: "c",
      cpp: "cpp",
      javascript: "js",
      plaintext: "txt",
      python: "py",
      typescript: "ts",
    }[language];
    const blob = new Blob([value], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `crustpad-${roomId}.${extension}`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleRun = async () => {
    const model = editorInstance?.getModel();
    if (!model || runResult.status === "running") {
      return;
    }

    const runId = runCounter.current + 1;
    runCounter.current = runId;
    setRunResult({ status: "running", language });

    const result = await runCode({
      language,
      source: model.getValue(),
    });

    if (runCounter.current === runId) {
      setRunResult(result);
    }
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
          onDownload={handleDownload}
          onEditUser={openProfileEditor}
          onLoadSource={handleLoadSource}
          onRun={handleRun}
          runDisabled={!canRunLanguage(language) || runResult.status === "running"}
          running={runResult.status === "running"}
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
          <OutputPanel result={runResult} />
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
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const environment = localHosts.has(window.location.hostname)
    ? "development"
    : "production";

  return (
    <footer className="footer">
      <div className="footer-badge">
        <VscRemote />
        <span>Crustpad ({environment})</span>
      </div>
    </footer>
  );
}
