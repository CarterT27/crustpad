import { useRef, useState } from "react";
import { FaPalette } from "react-icons/fa";
import type { UserInfo } from "./protocol";

type ProfilePopoverProps = {
  user: UserInfo;
  onCommit: (user: UserInfo) => void;
};

export function ProfilePopover({ user, onCommit }: ProfilePopoverProps) {
  const backdropMouseDown = useRef(false);
  const [draftName, setDraftName] = useState(user.name);
  const [draftHue, setDraftHue] = useState(user.hue);
  const commit = () => {
    onCommit({ name: draftName.trim() || user.name, hue: draftHue });
  };

  return (
    <div
      className="popover-backdrop"
      onMouseDown={(event) => {
        backdropMouseDown.current = event.currentTarget === event.target;
      }}
      onMouseUp={(event) => {
        if (backdropMouseDown.current && event.currentTarget === event.target) {
          commit();
        }
        backdropMouseDown.current = false;
      }}
    >
      <div className="user-popover">
        <div className="popover-header">Update Info</div>
        <button className="popover-close" type="button" onClick={commit}>
          x
        </button>
        <div className="popover-body">
          <input
            autoFocus
            value={draftName}
            maxLength={25}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "Escape") {
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
          <button type="button" onClick={commit}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
