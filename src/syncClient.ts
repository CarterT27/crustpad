import debounce from "lodash.debounce";
import type { IDisposable, IPosition, editor } from "monaco-editor";
import {
  compose,
  isNoop,
  normalize,
  transform,
  transformIndex,
  type OperationSeq,
} from "./ot";
import type {
  ClientMsg,
  CursorData,
  LanguageId,
  ServerMsg,
  UserInfo,
  UserOperation,
} from "./protocol";

export type SyncClientOptions = {
  uri: string;
  editor: editor.IStandaloneCodeEditor;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onDesynchronized?: () => void;
  onChangeLanguage?: (language: LanguageId) => void;
  onChangeUsers?: (users: Record<number, UserInfo>) => void;
  reconnectInterval?: number;
};

export class SyncClient {
  private ws?: WebSocket;
  private connecting = false;
  private disposed = false;
  private recentFailures = 0;
  private readonly model: editor.ITextModel;
  private readonly onChangeHandle: IDisposable;
  private readonly onCursorHandle: IDisposable;
  private readonly onSelectionHandle: IDisposable;
  private readonly beforeUnload: (event: BeforeUnloadEvent) => void;
  private readonly tryConnectId: number;
  private readonly resetFailuresId: number;

  private me = -1;
  private revision = 0;
  private outstanding?: OperationSeq;
  private buffer?: OperationSeq;
  private users: Record<number, UserInfo> = {};
  private userCursors: Record<number, CursorData> = {};
  private myInfo?: UserInfo;
  private cursorData: CursorData = { cursors: [], selections: [] };

  private lastValue = "";
  private ignoreChanges = false;
  private oldDecorations: string[] = [];

  constructor(private readonly options: SyncClientOptions) {
    const model = options.editor.getModel();
    if (!model) {
      throw new Error("SyncClient requires a Monaco model");
    }

    this.model = model;
    this.lastValue = model.getValue();
    this.onChangeHandle = options.editor.onDidChangeModelContent((event) =>
      this.onChange(event),
    );

    const cursorUpdate = debounce(() => this.sendCursorData(), 20);
    this.onCursorHandle = options.editor.onDidChangeCursorPosition((event) => {
      this.onCursor(event);
      cursorUpdate();
    });
    this.onSelectionHandle = options.editor.onDidChangeCursorSelection((event) => {
      this.onSelection(event);
      cursorUpdate();
    });

    this.beforeUnload = (event: BeforeUnloadEvent) => {
      if (this.outstanding) {
        event.preventDefault();
        event.returnValue = "";
      } else {
        delete event.returnValue;
      }
    };
    window.addEventListener("beforeunload", this.beforeUnload);

    const interval = options.reconnectInterval ?? 1000;
    this.tryConnect();
    this.tryConnectId = window.setInterval(() => this.tryConnect(), interval);
    this.resetFailuresId = window.setInterval(
      () => (this.recentFailures = 0),
      15 * interval,
    );
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    window.clearInterval(this.tryConnectId);
    window.clearInterval(this.resetFailuresId);
    this.onSelectionHandle.dispose();
    this.onCursorHandle.dispose();
    this.onChangeHandle.dispose();
    window.removeEventListener("beforeunload", this.beforeUnload);

    const ws = this.ws;
    this.ws = undefined;
    this.connecting = false;
    if (ws) {
      ws.onopen = null;
      ws.onclose = null;
      ws.onmessage = null;
      ws.close();
    }
  }

  setLanguage(language: LanguageId): boolean {
    this.send({ type: "setLanguage", language });
    return this.ws !== undefined;
  }

  setInfo(info: UserInfo): void {
    this.myInfo = info;
    this.sendInfo();
  }

  private tryConnect(): void {
    if (this.disposed || this.connecting || this.ws) {
      return;
    }

    this.connecting = true;
    const ws = new WebSocket(this.options.uri);
    ws.onopen = () => {
      if (this.disposed) {
        ws.close();
        return;
      }

      this.connecting = false;
      this.ws = ws;
      this.options.onConnected?.();
      this.users = {};
      this.options.onChangeUsers?.(this.users);
      this.sendInfo();
      this.sendCursorData();
    };
    ws.onclose = () => {
      if (this.disposed) {
        return;
      }

      if (this.ws !== ws) {
        this.connecting = false;
        return;
      }

      this.ws = undefined;
      this.connecting = false;
      if (this.outstanding) {
        this.desynchronize();
        return;
      }

      this.options.onDisconnected?.();
      if (++this.recentFailures >= 5) {
        this.desynchronize();
      }
    };
    ws.onmessage = ({ data }) => {
      if (!this.disposed && this.ws === ws && typeof data === "string") {
        this.handleMessage(JSON.parse(data) as ServerMsg);
      }
    };
  }

  private desynchronize(): void {
    this.dispose();
    this.options.onDesynchronized?.();
  }

  private handleMessage(message: ServerMsg): void {
    switch (message.type) {
      case "identity":
        this.me = message.id;
        break;
      case "history":
        this.handleHistory(message.start, message.operations);
        break;
      case "language":
        this.options.onChangeLanguage?.(message.language);
        break;
      case "userInfo":
        this.handleUserInfo(message.id, message.info);
        break;
      case "userCursor":
        this.handleUserCursor(message.id, message.data);
        break;
    }
  }

  private handleHistory(start: number, operations: UserOperation[]): void {
    const end = start + operations.length;
    if (start > this.revision || end < this.revision) {
      console.warn("History message is incompatible with current revision.");
      this.desynchronize();
      return;
    }

    for (let i = this.revision - start; i < operations.length; i += 1) {
      const { id, operation } = operations[i];
      this.revision += 1;
      if (id === this.me) {
        this.serverAck();
      } else {
        this.applyServer(operation);
      }
    }
  }

  private handleUserInfo(id: number, info: UserInfo | null): void {
    if (id === this.me) {
      return;
    }

    this.users = { ...this.users };
    if (info) {
      this.users[id] = info;
    } else {
      delete this.users[id];
      delete this.userCursors[id];
    }
    this.updateCursors();
    this.options.onChangeUsers?.(this.users);
  }

  private handleUserCursor(id: number, data: CursorData): void {
    if (id === this.me) {
      return;
    }

    this.userCursors[id] = data;
    this.updateCursors();
  }

  private serverAck(): void {
    if (!this.outstanding) {
      console.warn("Received serverAck with no outstanding operation.");
      return;
    }

    this.outstanding = this.buffer;
    this.buffer = undefined;
    if (this.outstanding) {
      this.sendOperation(this.outstanding);
    }
  }

  private applyServer(operation: OperationSeq): void {
    if (this.outstanding) {
      let pair = transform(this.outstanding, operation);
      this.outstanding = pair[0];
      operation = pair[1];
      if (this.buffer) {
        pair = transform(this.buffer, operation);
        this.buffer = pair[0];
        operation = pair[1];
      }
    }
    this.applyOperation(operation);
  }

  private applyClient(operation: OperationSeq): void {
    if (isNoop(operation)) {
      return;
    }

    if (!this.ws) {
      this.desynchronize();
      return;
    }

    if (!this.outstanding) {
      this.sendOperation(operation);
      this.outstanding = operation;
    } else if (!this.buffer) {
      this.buffer = operation;
    } else {
      this.buffer = compose(this.buffer, operation);
    }
    this.transformCursors(operation);
  }

  private sendOperation(operation: OperationSeq): void {
    this.send({
      type: "edit",
      revision: this.revision,
      operation,
    });
  }

  private sendInfo(): void {
    if (this.myInfo) {
      this.send({ type: "clientInfo", info: this.myInfo });
    }
  }

  private sendCursorData(): void {
    if (!this.buffer) {
      this.send({ type: "cursorData", data: this.cursorData });
    }
  }

  private send(message: ClientMsg): void {
    this.ws?.send(JSON.stringify(message));
  }

  private applyOperation(operation: OperationSeq): void {
    if (isNoop(operation)) {
      return;
    }

    this.ignoreChanges = true;
    let index = 0;
    for (const component of operation) {
      if (component.type === "insert") {
        const position = unicodePosition(this.model, index);
        index += unicodeLength(component.text);
        // Remote edits intentionally bypass Monaco's local undo stack. A future
        // collaborative-aware undo should track local inverses and transform them
        // through remote history instead.
        this.model.applyEdits(
          [
            {
              range: {
                startLineNumber: position.lineNumber,
                startColumn: position.column,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
              },
              text: component.text,
              forceMoveMarkers: true,
            },
          ],
          false,
        );
      } else if (component.type === "retain") {
        index += component.count;
      } else {
        const from = unicodePosition(this.model, index);
        const to = unicodePosition(this.model, index + component.count);
        this.model.applyEdits(
          [
            {
              range: {
                startLineNumber: from.lineNumber,
                startColumn: from.column,
                endLineNumber: to.lineNumber,
                endColumn: to.column,
              },
              text: "",
              forceMoveMarkers: true,
            },
          ],
          false,
        );
      }
    }

    this.lastValue = this.model.getValue();
    this.ignoreChanges = false;
    this.transformCursors(operation);
  }

  private transformCursors(operation: OperationSeq): void {
    for (const data of Object.values(this.userCursors)) {
      data.cursors = data.cursors.map((cursor) => transformIndex(operation, cursor));
      data.selections = data.selections.map(([start, end]) => [
        transformIndex(operation, start),
        transformIndex(operation, end),
      ]);
    }
    this.updateCursors();
  }

  private updateCursors(): void {
    const decorations: editor.IModelDeltaDecoration[] = [];

    for (const [id, data] of Object.entries(this.userCursors)) {
      const user = this.users[Number(id)];
      if (!user) {
        continue;
      }

      generateCssStyles(user.hue);
      for (const cursor of data.cursors) {
        const position = unicodePosition(this.model, cursor);
        decorations.push({
          options: {
            className: `remote-cursor-${user.hue}`,
            stickiness: 1,
            zIndex: 2,
          },
          range: {
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          },
        });
      }
      for (const [start, end] of data.selections) {
        const position = unicodePosition(this.model, start);
        const positionEnd = unicodePosition(this.model, end);
        decorations.push({
          options: {
            className: `remote-selection-${user.hue}`,
            hoverMessage: { value: user.name },
            stickiness: 1,
            zIndex: 1,
          },
          range: {
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: positionEnd.lineNumber,
            endColumn: positionEnd.column,
          },
        });
      }
    }

    this.oldDecorations = this.model.deltaDecorations(
      this.oldDecorations,
      decorations,
    );
  }

  private onChange(event: editor.IModelContentChangedEvent): void {
    if (this.ignoreChanges) {
      return;
    }

    const operation = operationFromChangeEvent(this.lastValue, event);
    this.applyClient(operation);
    this.lastValue = this.model.getValue();
  }

  private onCursor(event: editor.ICursorPositionChangedEvent): void {
    const cursors = [event.position, ...event.secondaryPositions];
    this.cursorData.cursors = cursors.map((position) =>
      unicodeOffset(this.model, position),
    );
  }

  private onSelection(event: editor.ICursorSelectionChangedEvent): void {
    const selections = [event.selection, ...event.secondarySelections];
    this.cursorData.selections = selections.map((selection) => [
      unicodeOffset(this.model, selection.getStartPosition()),
      unicodeOffset(this.model, selection.getEndPosition()),
    ]);
  }
}

function unicodeLength(text: string): number {
  return Array.from(text).length;
}

function operationFromChangeEvent(
  before: string,
  event: editor.IModelContentChangedEvent,
): OperationSeq {
  const contentLength = unicodeLength(before);
  let offset = 0;
  let operation = normalize([{ type: "retain", count: contentLength }]);
  const changes = [...event.changes].sort((a, b) => b.rangeOffset - a.rangeOffset);

  for (const change of changes) {
    const initialLength = unicodeLength(before.slice(0, change.rangeOffset));
    const deletedLength = unicodeLength(
      before.slice(change.rangeOffset, change.rangeOffset + change.rangeLength),
    );
    const restLength = contentLength + offset - initialLength - deletedLength;
    const changeOperation = normalize([
      { type: "retain", count: initialLength },
      { type: "delete", count: deletedLength },
      { type: "insert", text: change.text },
      { type: "retain", count: restLength },
    ]);

    operation = compose(operation, changeOperation);
    offset += unicodeLength(change.text) - deletedLength;
  }

  return operation;
}

function unicodeOffset(model: editor.ITextModel, position: IPosition): number {
  const value = model.getValue();
  const offsetUTF16 = model.getOffsetAt(position);
  return unicodeLength(value.slice(0, offsetUTF16));
}

function unicodePosition(model: editor.ITextModel, offset: number): IPosition {
  const value = model.getValue();
  let offsetUTF16 = 0;
  for (const codepoint of value) {
    if (offset <= 0) {
      break;
    }
    offsetUTF16 += codepoint.length;
    offset -= 1;
  }
  return model.getPositionAt(offsetUTF16);
}

const generatedStyles = new Set<number>();

function generateCssStyles(hue: number): void {
  if (generatedStyles.has(hue)) {
    return;
  }

  generatedStyles.add(hue);
  const css = `
    .monaco-editor .remote-selection-${hue} {
      background-color: hsla(${hue}, 90%, 70%, 0.35);
    }
    .monaco-editor .remote-cursor-${hue} {
      border-left: 2px solid hsl(${hue}, 88%, 45%);
    }
  `;
  const element = document.createElement("style");
  element.appendChild(document.createTextNode(css));
  document.head.appendChild(element);
}
