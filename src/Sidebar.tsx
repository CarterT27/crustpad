import {
  VscAccount,
  VscCloudDownload,
  VscCircleFilled,
  VscRepo,
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
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <ConnectionStatus connection={connection} darkMode={darkMode} />

      <div className="sidebar-row">
        <h2>Dark Mode</h2>
        <label className="switch">
          <input
            type="checkbox"
            checked={darkMode}
            onChange={() => onChangeDarkMode(!darkMode)}
          />
          <span />
        </label>
      </div>

      <h2>Language</h2>
      <select
        className="rustpad-select"
        value={language}
        onChange={(event) => onChangeLanguage(event.target.value as LanguageId)}
      >
        {languages.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>

      <button className="sidebar-action" type="button" onClick={onDownload}>
        <VscCloudDownload />
        Download
      </button>

      <h2>Share Link</h2>
      <div className="share-link">
        <input readOnly value={shareHref} />
        <button type="button" onClick={() => navigator.clipboard.writeText(shareHref)}>
          Copy
        </button>
      </div>

      <h2>Active Users</h2>
      <div className="user-list">
        <UserRow user={currentUser} darkMode={darkMode} isMe onClick={onEditUser} />
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
        Built using Bun and TypeScript, with a collaboration model ported from
        Rustpad. See the{" "}
        <a href="https://github.com/ekzhang/rustpad" target="_blank">
          GitHub repository
        </a>{" "}
        that inspired the editor.
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
  return (
    <button className="user-row" type="button" onClick={onClick}>
      <VscAccount />
      <span style={{ color: nameColor }}>{user.name}</span>
      {isMe ? <span className="you-label">(you)</span> : null}
    </button>
  );
}
