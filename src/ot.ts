export type OpComponent =
  | { type: "retain"; count: number }
  | { type: "insert"; text: string }
  | { type: "delete"; count: number };

export type OperationSeq = OpComponent[];

export class OTError extends Error {
  constructor(message = "incompatible lengths") {
    super(message);
    this.name = "OTError";
  }
}

type CurrentOp = OpComponent | undefined;

export function apply(text: string, op: OperationSeq): string {
  if (codepointLength(text) !== baseLength(op)) {
    throw new OTError();
  }

  const chars = codepoints(text);
  const output: string[] = [];
  let index = 0;

  for (const component of op) {
    switch (component.type) {
      case "retain":
        output.push(...chars.slice(index, index + component.count));
        index += component.count;
        break;
      case "insert":
        output.push(component.text);
        break;
      case "delete":
        index += component.count;
        break;
    }
  }

  return output.join("");
}

export function compose(a: OperationSeq, b: OperationSeq): OperationSeq {
  if (targetLength(a) !== baseLength(b)) {
    throw new OTError();
  }

  const result = builder();
  const iterA = iterator(a);
  const iterB = iterator(b);
  let opA = iterA.next();
  let opB = iterB.next();

  while (opA || opB) {
    if (opA?.type === "delete") {
      result.delete(opA.count);
      opA = iterA.next();
      continue;
    }

    if (opB?.type === "insert") {
      result.insert(opB.text);
      opB = iterB.next();
      continue;
    }

    if (!opA || !opB) {
      throw new OTError();
    }

    if (opA.type === "retain" && opB.type === "retain") {
      const count = Math.min(opA.count, opB.count);
      result.retain(count);
      opA = advanceOrRemainder(iterA, opA, count);
      opB = advanceOrRemainder(iterB, opB, count);
      continue;
    }

    if (opA.type === "insert" && opB.type === "delete") {
      const count = Math.min(codepointLength(opA.text), opB.count);
      opA = advanceOrRemainder(iterA, opA, count);
      opB = advanceOrRemainder(iterB, opB, count);
      continue;
    }

    if (opA.type === "insert" && opB.type === "retain") {
      const count = Math.min(codepointLength(opA.text), opB.count);
      result.insert(takeText(opA.text, count));
      opA = advanceOrRemainder(iterA, opA, count);
      opB = advanceOrRemainder(iterB, opB, count);
      continue;
    }

    if (opA.type === "retain" && opB.type === "delete") {
      const count = Math.min(opA.count, opB.count);
      result.delete(count);
      opA = advanceOrRemainder(iterA, opA, count);
      opB = advanceOrRemainder(iterB, opB, count);
      continue;
    }
  }

  return result.done();
}

export function transform(
  a: OperationSeq,
  b: OperationSeq,
): [OperationSeq, OperationSeq] {
  if (baseLength(a) !== baseLength(b)) {
    throw new OTError();
  }

  const aPrime = builder();
  const bPrime = builder();
  const iterA = iterator(a);
  const iterB = iterator(b);
  let opA = iterA.next();
  let opB = iterB.next();

  while (opA || opB) {
    if (opA?.type === "insert") {
      aPrime.insert(opA.text);
      bPrime.retain(codepointLength(opA.text));
      opA = iterA.next();
      continue;
    }

    if (opB?.type === "insert") {
      aPrime.retain(codepointLength(opB.text));
      bPrime.insert(opB.text);
      opB = iterB.next();
      continue;
    }

    if (!opA || !opB) {
      throw new OTError();
    }

    if (opA.type === "retain" && opB.type === "retain") {
      const count = Math.min(opA.count, opB.count);
      aPrime.retain(count);
      bPrime.retain(count);
      opA = advanceOrRemainder(iterA, opA, count);
      opB = advanceOrRemainder(iterB, opB, count);
      continue;
    }

    if (opA.type === "delete" && opB.type === "delete") {
      const count = Math.min(opA.count, opB.count);
      opA = advanceOrRemainder(iterA, opA, count);
      opB = advanceOrRemainder(iterB, opB, count);
      continue;
    }

    if (opA.type === "delete" && opB.type === "retain") {
      const count = Math.min(opA.count, opB.count);
      aPrime.delete(count);
      opA = advanceOrRemainder(iterA, opA, count);
      opB = advanceOrRemainder(iterB, opB, count);
      continue;
    }

    if (opA.type === "retain" && opB.type === "delete") {
      const count = Math.min(opA.count, opB.count);
      bPrime.delete(count);
      opA = advanceOrRemainder(iterA, opA, count);
      opB = advanceOrRemainder(iterB, opB, count);
      continue;
    }
  }

  return [aPrime.done(), bPrime.done()];
}

export function transformIndex(op: OperationSeq, index: number): number {
  let remaining = index;
  let transformed = index;

  for (const component of op) {
    switch (component.type) {
      case "retain":
        remaining -= component.count;
        break;
      case "insert":
        transformed += codepointLength(component.text);
        break;
      case "delete": {
        const deletedBeforeIndex = Math.min(remaining, component.count);
        transformed -= deletedBeforeIndex;
        remaining -= component.count;
        break;
      }
    }

    if (remaining < 0) {
      break;
    }
  }

  return transformed;
}

export function baseLength(op: OperationSeq): number {
  return op.reduce((length, component) => {
    if (component.type === "insert") {
      return length;
    }
    return length + component.count;
  }, 0);
}

export function targetLength(op: OperationSeq): number {
  return op.reduce((length, component) => {
    switch (component.type) {
      case "retain":
        return length + component.count;
      case "insert":
        return length + codepointLength(component.text);
      case "delete":
        return length;
    }
  }, 0);
}

export function isNoop(op: OperationSeq): boolean {
  return (
    op.length === 0 ||
    op.every((component) => component.type === "retain" || isEmpty(component))
  );
}

export function normalize(op: OperationSeq): OperationSeq {
  const normalized = builder();
  for (const component of op) {
    switch (component.type) {
      case "retain":
        normalized.retain(component.count);
        break;
      case "insert":
        normalized.insert(component.text);
        break;
      case "delete":
        normalized.delete(component.count);
        break;
    }
  }
  return normalized.done();
}

function builder() {
  const ops: OperationSeq = [];

  return {
    retain(count: number) {
      assertNonNegativeInteger(count);
      if (count === 0) {
        return;
      }

      const last = ops.at(-1);
      if (last?.type === "retain") {
        last.count += count;
      } else {
        ops.push({ type: "retain", count });
      }
    },

    insert(text: string) {
      if (text.length === 0) {
        return;
      }

      const last = ops.at(-1);
      const secondLast = ops.at(-2);
      if (last?.type === "insert") {
        last.text += text;
      } else if (last?.type === "delete" && secondLast?.type === "insert") {
        secondLast.text += text;
      } else if (last?.type === "delete") {
        ops[ops.length - 1] = { type: "insert", text };
        ops.push(last);
      } else {
        ops.push({ type: "insert", text });
      }
    },

    delete(count: number) {
      assertNonNegativeInteger(count);
      if (count === 0) {
        return;
      }

      const last = ops.at(-1);
      if (last?.type === "delete") {
        last.count += count;
      } else {
        ops.push({ type: "delete", count });
      }
    },

    done() {
      return ops;
    },
  };
}

function iterator(op: OperationSeq) {
  let index = 0;
  return {
    next(): CurrentOp {
      return clone(op[index++]);
    },
  };
}

function advanceOrRemainder(
  iter: ReturnType<typeof iterator>,
  op: OpComponent,
  count: number,
): CurrentOp {
  const length = componentLength(op);
  if (count === length) {
    return iter.next();
  }

  if (op.type === "insert") {
    return { type: "insert", text: skipText(op.text, count) };
  }

  return { type: op.type, count: length - count };
}

function componentLength(op: OpComponent): number {
  return op.type === "insert" ? codepointLength(op.text) : op.count;
}

function codepointLength(text: string): number {
  return codepoints(text).length;
}

function codepoints(text: string): string[] {
  return Array.from(text);
}

function takeText(text: string, count: number): string {
  return codepoints(text).slice(0, count).join("");
}

function skipText(text: string, count: number): string {
  return codepoints(text).slice(count).join("");
}

function clone(op: CurrentOp): CurrentOp {
  if (!op) {
    return undefined;
  }
  return op.type === "insert" ? { ...op } : { ...op };
}

function isEmpty(component: OpComponent): boolean {
  if (component.type === "insert") {
    return component.text.length === 0;
  }
  return component.count === 0;
}

function assertNonNegativeInteger(value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("operation counts must be non-negative safe integers");
  }
}
