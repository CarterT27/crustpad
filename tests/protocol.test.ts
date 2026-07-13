import { describe, expect, test } from "bun:test";
import {
  isPersistedDocument,
  isUserInfo,
  isUserOperations,
  MAX_DOCUMENT_LENGTH,
  MAX_OPERATION_COMPONENTS,
} from "../src/protocol";

describe("protocol validators", () => {
  test("validates persisted document languages and size", () => {
    expect(isPersistedDocument({ text: "hello", language: "typescript" })).toBe(
      true,
    );
    expect(isPersistedDocument({ text: "hello", language: "ruby" })).toBe(false);
    expect(
      isPersistedDocument({
        text: "x".repeat(MAX_DOCUMENT_LENGTH + 1),
        language: "plaintext",
      }),
    ).toBe(false);
  });

  test("reuses bounded user and operation validation", () => {
    expect(isUserInfo({ name: "Ada", hue: 120 })).toBe(true);
    expect(isUserInfo({ name: "", hue: 120 })).toBe(false);
    expect(isUserInfo({ name: "Ada", hue: 360 })).toBe(false);
    expect(
      isUserOperations([
        { id: 1, operation: [{ type: "insert", text: "hello" }] },
      ]),
    ).toBe(true);
    expect(
      isUserOperations([
        {
          id: 1,
          operation: Array.from(
            { length: MAX_OPERATION_COMPONENTS + 1 },
            () => ({ type: "retain", count: 0 }),
          ),
        },
      ]),
    ).toBe(false);
  });
});
