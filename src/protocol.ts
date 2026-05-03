import type { OperationSeq } from "./ot";

export const languages = ["javascript", "typescript", "python", "plaintext"] as const;

export type LanguageId = (typeof languages)[number];
export type UserId = number;

export type UserOperation = {
  id: UserId;
  operation: OperationSeq;
};

export type UserInfo = {
  name: string;
  hue: number;
};

export type CursorData = {
  cursors: number[];
  selections: Array<[number, number]>;
};

export type ClientMsg =
  | { type: "edit"; revision: number; operation: OperationSeq }
  | { type: "setLanguage"; language: LanguageId }
  | { type: "clientInfo"; info: UserInfo }
  | { type: "cursorData"; data: CursorData };

export type ServerMsg =
  | { type: "identity"; id: UserId }
  | { type: "history"; start: number; operations: UserOperation[] }
  | { type: "language"; language: LanguageId }
  | { type: "userInfo"; id: UserId; info: UserInfo | null }
  | { type: "userCursor"; id: UserId; data: CursorData };

export type PersistedDocument = {
  text: string;
  language: LanguageId;
};

export function isLanguageId(value: unknown): value is LanguageId {
  return typeof value === "string" && languages.includes(value as LanguageId);
}
