import { useRef } from "react";
import { FaPalette } from "react-icons/fa";

type ProfilePopoverProps = {
  draftName: string;
  draftHue: number;
  onChangeName: (name: string) => void;
  onChangeHue: (hue: number) => void;
  onCommit: () => void;
};

export function ProfilePopover({
  draftName,
  draftHue,
  onChangeName,
  onChangeHue,
  onCommit,
}: ProfilePopoverProps) {
  const backdropMouseDown = useRef(false);

  return (
    <div
      className="popover-backdrop"
      onMouseDown={(event) => {
        backdropMouseDown.current = event.currentTarget === event.target;
      }}
      onMouseUp={(event) => {
        if (backdropMouseDown.current && event.currentTarget === event.target) {
          onCommit();
        }
        backdropMouseDown.current = false;
      }}
    >
      <div className="user-popover">
        <div className="popover-header">Update Info</div>
        <button className="popover-close" type="button" onClick={onCommit}>
          x
        </button>
        <div className="popover-body">
          <input
            autoFocus
            value={draftName}
            maxLength={25}
            onChange={(event) => onChangeName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "Escape") {
                event.preventDefault();
                onCommit();
              }
            }}
          />
          <button
            type="button"
            onClick={() => onChangeHue(Math.floor(Math.random() * 360))}
          >
            <FaPalette />
            Change Color
          </button>
        </div>
        <div className="popover-footer">
          <button type="button" onClick={onCommit}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
