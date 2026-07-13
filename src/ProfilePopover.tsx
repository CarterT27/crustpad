import { useEffect, useRef, useState } from "react";
import { FaPalette } from "react-icons/fa";
import type { UserInfo } from "./protocol";

type ProfilePopoverProps = {
  user: UserInfo;
  onCommit: (user: UserInfo) => void;
  onCancel: () => void;
};

export function ProfilePopover({
  user,
  onCommit,
  onCancel,
}: ProfilePopoverProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draftName, setDraftName] = useState(user.name);
  const [draftHue, setDraftHue] = useState(user.hue);
  const commit = () => {
    onCommit({ name: draftName.trim() || user.name, hue: draftHue });
  };

  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="user-popover"
      aria-labelledby="profile-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onMouseDown={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          onCancel();
        }
      }}
    >
      <div className="popover-header" id="profile-dialog-title">
        Update Info
      </div>
      <button
        aria-label="Close profile editor"
        className="popover-close"
        type="button"
        onClick={onCancel}
      >
        ×
      </button>
      <div className="popover-body">
        <label htmlFor="profile-name">Display name</label>
        <input
          id="profile-name"
          autoFocus
          value={draftName}
          maxLength={25}
          onChange={(event) => setDraftName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
        />
        <button
          type="button"
          onClick={() => setDraftHue(Math.floor(Math.random() * 360))}
        >
          <FaPalette />
          Change Color
        </button>
      </div>
      <div className="popover-footer">
        <button className="popover-cancel" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" onClick={commit}>
          Done
        </button>
      </div>
    </dialog>
  );
}
