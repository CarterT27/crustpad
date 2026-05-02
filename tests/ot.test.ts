import { describe, expect, test } from "bun:test";
import {
  apply,
  baseLength,
  compose,
  isNoop,
  normalize,
  targetLength,
  transform,
  transformIndex,
  type OperationSeq,
} from "../src/ot";

describe("operation lengths", () => {
  test("counts Unicode code points", () => {
    const op: OperationSeq = [{ type: "insert", text: "h🎉e🎉l👨‍👨‍👦‍👦lo" }];

    expect(baseLength(op)).toBe(0);
    expect(targetLength(op)).toBe(14);
    expect(apply("", op)).toBe("h🎉e🎉l👨‍👨‍👦‍👦lo");
  });

  test("normalizes empty and adjacent components", () => {
    const op = normalize([
      { type: "retain", count: 5 },
      { type: "retain", count: 0 },
      { type: "insert", text: "lorem" },
      { type: "insert", text: "" },
      { type: "delete", count: 3 },
      { type: "delete", count: 0 },
    ]);

    expect(op).toEqual([
      { type: "retain", count: 5 },
      { type: "insert", text: "lorem" },
      { type: "delete", count: 3 },
    ]);
  });

  test("keeps inserts before deletes at one position", () => {
    const op = normalize([
      { type: "delete", count: 1 },
      { type: "insert", text: "l" },
      { type: "insert", text: "o" },
      { type: "retain", count: 5 },
    ]);

    expect(op).toEqual([
      { type: "insert", text: "lo" },
      { type: "delete", count: 1 },
      { type: "retain", count: 5 },
    ]);
  });
});

describe("apply", () => {
  test("applies retains, inserts, and deletes", () => {
    const op: OperationSeq = [
      { type: "retain", count: 2 },
      { type: "insert", text: "yy" },
      { type: "delete", count: 2 },
      { type: "retain", count: 1 },
    ];

    expect(apply("abcde", op)).toBe("abyye");
  });

  test("rejects operations with the wrong base length", () => {
    expect(() => apply("abc", [{ type: "retain", count: 2 }])).toThrow(
      "incompatible lengths",
    );
  });
});

describe("compose", () => {
  test("preserves consecutive edits", () => {
    const a: OperationSeq = [{ type: "insert", text: "abc" }];
    const b: OperationSeq = [
      { type: "retain", count: 3 },
      { type: "insert", text: "def" },
    ];

    const ab = compose(a, b);

    expect(apply("", ab)).toBe("abcdef");
    expect(ab).toEqual([{ type: "insert", text: "abcdef" }]);
  });

  test("handles inserted text deleted by the next operation", () => {
    const a: OperationSeq = [
      { type: "retain", count: 1 },
      { type: "insert", text: "xy" },
      { type: "retain", count: 2 },
    ];
    const b: OperationSeq = [
      { type: "retain", count: 2 },
      { type: "delete", count: 1 },
      { type: "retain", count: 2 },
    ];

    const afterA = apply("abc", a);
    const afterB = apply(afterA, b);

    expect(apply("abc", compose(a, b))).toBe(afterB);
    expect(afterB).toBe("axbc");
  });

  test("matches applying two operations in sequence", () => {
    const rng = makeRng(0x12345678);

    for (let i = 0; i < 250; i += 1) {
      const text = randomText(rng, 20);
      const a = randomOperation(rng, text);
      const afterA = apply(text, a);
      const b = randomOperation(rng, afterA);
      const afterB = apply(afterA, b);

      expect(apply(text, compose(a, b))).toBe(afterB);
    }
  });
});

describe("transform", () => {
  test("converges concurrent inserts at the same index", () => {
    const text = "abc";
    const a: OperationSeq = [
      { type: "retain", count: 3 },
      { type: "insert", text: "def" },
    ];
    const b: OperationSeq = [
      { type: "retain", count: 3 },
      { type: "insert", text: "ghi" },
    ];

    const [aPrime, bPrime] = transform(a, b);

    expect(apply(apply(text, a), bPrime)).toBe(apply(apply(text, b), aPrime));
    expect(compose(a, bPrime)).toEqual(compose(b, aPrime));
    expect(apply(apply(text, a), bPrime)).toBe("abcdefghi");
  });

  test("converges overlapping deletes", () => {
    const text = "abcdef";
    const a: OperationSeq = [
      { type: "retain", count: 1 },
      { type: "delete", count: 3 },
      { type: "retain", count: 2 },
    ];
    const b: OperationSeq = [
      { type: "retain", count: 2 },
      { type: "delete", count: 3 },
      { type: "retain", count: 1 },
    ];

    const [aPrime, bPrime] = transform(a, b);

    expect(apply(apply(text, a), bPrime)).toBe(apply(apply(text, b), aPrime));
    expect(apply(apply(text, a), bPrime)).toBe("af");
  });

  test("converges generated concurrent operations", () => {
    const rng = makeRng(0x87654321);

    for (let i = 0; i < 250; i += 1) {
      const text = randomText(rng, 20);
      const a = randomOperation(rng, text);
      const b = randomOperation(rng, text);
      const [aPrime, bPrime] = transform(a, b);

      expect(apply(apply(text, a), bPrime)).toBe(apply(apply(text, b), aPrime));
      expect(compose(a, bPrime)).toEqual(compose(b, aPrime));
    }
  });
});

describe("transformIndex", () => {
  test("shifts cursors through Unicode inserts", () => {
    const op: OperationSeq = [{ type: "insert", text: "🎉" }];

    expect([0, 1, 2, 3].map((index) => transformIndex(op, index))).toEqual([
      1, 2, 3, 4,
    ]);
  });

  test("moves indexes through deletes like Rustpad cursor transforms", () => {
    const op: OperationSeq = [
      { type: "retain", count: 2 },
      { type: "delete", count: 3 },
    ];

    expect([0, 2, 3, 5, 6].map((index) => transformIndex(op, index))).toEqual([
      0, 2, 2, 2, 3,
    ]);
  });
});

function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomText(rng: () => number, maxLength: number): string {
  const alphabet = ["a", "b", "c", "d", "🎉", "😍", "𒀇", "👨", "\u0301"];
  const length = Math.floor(rng() * (maxLength + 1));
  let text = "";
  for (let i = 0; i < length; i += 1) {
    text += alphabet[Math.floor(rng() * alphabet.length)];
  }
  return text;
}

function randomOperation(rng: () => number, text: string): OperationSeq {
  const op: OperationSeq = [];
  let consumed = 0;
  const length = Array.from(text).length;

  while (consumed < length) {
    const remaining = length - consumed;
    const count = 1 + Math.floor(rng() * Math.min(remaining, 5));
    const choice = rng();

    if (choice < 0.2) {
      op.push({ type: "insert", text: randomText(rng, count) });
    } else if (choice < 0.4) {
      op.push({ type: "delete", count });
      consumed += count;
    } else {
      op.push({ type: "retain", count });
      consumed += count;
    }
  }

  if (rng() < 0.3) {
    op.push({ type: "insert", text: "1" + randomText(rng, 10) });
  }

  return normalize(op);
}

describe("isNoop", () => {
  test("accepts empty and retain-only operations", () => {
    expect(isNoop([])).toBe(true);
    expect(isNoop([{ type: "retain", count: 5 }])).toBe(true);
    expect(isNoop([{ type: "insert", text: "lorem" }])).toBe(false);
  });
});
