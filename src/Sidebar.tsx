import { useState } from "react";
import {
  VscAccount,
  VscChromeClose,
  VscCloudDownload,
  VscCircleFilled,
  VscRepo,
  VscRunAll,
} from "react-icons/vsc";
import type { LanguageId, UserInfo } from "./protocol";
import { languages } from "./protocol";
import type { Connection } from "./useSyncSession";

type SidebarProps = {
  connection: Connection;
  darkMode: boolean;
  language: LanguageId;
  shareHref: string;
  currentUser: UserInfo;
  remoteUsers: Record<number, UserInfo>;
  onChangeDarkMode: (darkMode: boolean) => void;
  onChangeLanguage: (language: LanguageId) => void;
  onDownload: () => void;
  onEditUser: () => void;
  onLoadSource: () => void;
  onRun: () => void;
  runDisabled: boolean;
  running: boolean;
  mobileOpen: boolean;
  onCloseMobile: () => void;
};

export function Sidebar({
  connection,
  darkMode,
  language,
  shareHref,
  currentUser,
  remoteUsers,
  onChangeDarkMode,
  onChangeLanguage,
  onDownload,
  onEditUser,
  onLoadSource,
  onRun,
  runDisabled,
  running,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const handleCopyShareLink = async () => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(shareHref);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };

  return (
    <aside
      className={`sidebar${mobileOpen ? " open" : ""}`}
      id="collaboration-sidebar"
    >
      <button
        aria-label="Close controls"
        className="sidebar-close"
        type="button"
        onClick={onCloseMobile}
      >
        <VscChromeClose />
      </button>
      <ConnectionStatus connection={connection} darkMode={darkMode} />

      <div className="sidebar-row">
        <h2>Dark Mode</h2>
        <label className="switch">
          <input
            aria-label="Dark mode"
            type="checkbox"
            checked={darkMode}
            onChange={() => onChangeDarkMode(!darkMode)}
          />
          <span />
        </label>
      </div>

      <h2>Language</h2>
      <select
        aria-label="Language"
        className="rustpad-select"
        value={language}
        disabled={connection !== "connected"}
        onChange={(event) => onChangeLanguage(event.target.value as LanguageId)}
      >
        {languages.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>

      <button
        className="sidebar-action run-code"
        type="button"
        onClick={onRun}
        disabled={runDisabled}
      >
        <VscRunAll />
        {running ? "Running..." : "Run"}
      </button>

      <button className="sidebar-action" type="button" onClick={onDownload}>
        <VscCloudDownload />
        Download
      </button>

      <h2>Share Link</h2>
      <div className="share-link">
        <input aria-label="Share link" readOnly value={shareHref} />
        <button
          type="button"
          onClick={handleCopyShareLink}
        >
          {copyStatus === "copied"
            ? "Copied"
            : copyStatus === "failed"
              ? "Retry"
              : "Copy"}
        </button>
      </div>
      <span className="copy-status" aria-live="polite">
        {copyStatus === "copied"
          ? "Share link copied"
          : copyStatus === "failed"
            ? "Could not copy share link"
            : ""}
      </span>

      <h2>Active Users</h2>
      <div className="user-list">
        <UserRow
          user={currentUser}
          darkMode={darkMode}
          isMe
          onClick={onEditUser}
        />
        {Object.entries(remoteUsers).map(([id, info]) => (
          <UserRow key={id} user={info} darkMode={darkMode} />
        ))}
      </div>

      <h2>About</h2>
      <p>
        <strong>Crustpad</strong> is an open-source collaborative code editor
        based on the <em>operational transformation</em> algorithm.
      </p>
      <p>
        Share a link to this pad with others, and they can edit from their
        browser while seeing your changes in real time.
      </p>
      <p>
        Inspired by Rustpad. Built using Bun and TypeScript. See the{" "}
        <a href="https://github.com/cartert27/crustpad" target="_blank">
          GitHub repository
        </a>{" "}
        for details.
      </p>

      <button
        className="sidebar-action read-code"
        type="button"
        onClick={onLoadSource}
      >
        <VscRepo />
        Read the code
      </button>
    </aside>
  );
}

function ConnectionStatus({
  connection,
  darkMode,
}: {
  connection: Connection;
  darkMode: boolean;
}) {
  const text = {
    connected: "You are connected!",
    disconnected: "Connecting to the server...",
    desynchronized: "Disconnected, please refresh.",
  }[connection];
  return (
    <div className="connection-status">
      <VscCircleFilled className={`connection-dot ${connection}`} />
      <span className={darkMode ? "muted dark" : "muted"}>{text}</span>
    </div>
  );
}

function UserRow({
  user,
  darkMode,
  isMe = false,
  onClick,
}: {
  user: UserInfo;
  darkMode: boolean;
  isMe?: boolean;
  onClick?: () => void;
}) {
  const nameColor = `hsl(${user.hue}, 90%, ${darkMode ? "70%" : "25%"})`;
  const content = (
    <>
      <VscAccount />
      <span style={{ color: nameColor }}>{user.name}</span>
      {isMe ? <span className="you-label">(you)</span> : null}
    </>
  );

  return onClick ? (
    <button className="user-row editable" type="button" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="user-row">{content}</div>
  );
}
