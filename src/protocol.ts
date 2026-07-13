import type { OperationSeq } from "./ot";

export const MAX_CLIENT_MESSAGE_LENGTH = 512 * 1024;
export const MAX_DOCUMENT_LENGTH = 256 * 1024;
export const MAX_OPERATION_COMPONENTS = 4_096;
export const MAX_USER_NAME_LENGTH = 25;

export const languages = [
  "c",
  "cpp",
  "javascript",
  "typescript",
  "python",
  "plaintext",
] as const;

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

export function isOperationSeq(value: unknown): value is OperationSeq {
  return (
    Array.isArray(value) &&
    value.length <= MAX_OPERATION_COMPONENTS &&
    value.every(isOperationComponent)
  );
}

export function isUserOperation(value: unknown): value is UserOperation {
  if (!value || typeof value !== "object") {
    return false;
  }

  const operation = value as Partial<UserOperation>;
  return (
    Number.isSafeInteger(operation.id) &&
    typeof operation.id === "number" &&
    isOperationSeq(operation.operation)
  );
}

export function isUserOperations(value: unknown): value is UserOperation[] {
  return Array.isArray(value) && value.every(isUserOperation);
}

export function isUserInfo(value: unknown): value is UserInfo {
  if (!value || typeof value !== "object") {
    return false;
  }

  const { name, hue } = value as Partial<UserInfo>;
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= MAX_USER_NAME_LENGTH &&
    Number.isSafeInteger(hue) &&
    typeof hue === "number" &&
    hue >= 0 &&
    hue <= 359
  );
}

export function isPersistedDocument(value: unknown): value is PersistedDocument {
  if (!value || typeof value !== "object") {
    return false;
  }

  const { text, language } = value as Partial<PersistedDocument>;
  return (
    typeof text === "string" &&
    Array.from(text).length <= MAX_DOCUMENT_LENGTH &&
    isLanguageId(language)
  );
}

function isOperationComponent(value: unknown): value is OperationSeq[number] {
  if (!value || typeof value !== "object") {
    return false;
  }

  const component = value as Partial<OperationSeq[number]>;
  switch (component.type) {
    case "retain":
    case "delete":
      return (
        Number.isSafeInteger(component.count) &&
        typeof component.count === "number" &&
        component.count >= 0
      );
    case "insert":
      return typeof component.text === "string";
    default:
      return false;
  }
}
