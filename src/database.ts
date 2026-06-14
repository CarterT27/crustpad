import { Database as SQLite } from "bun:sqlite";
import type { LanguageId, PersistedDocument, UserOperation } from "./protocol";
import { isLanguageId } from "./protocol";

export type StoredRoomState = {
  document: PersistedDocument;
  operations?: UserOperation[];
};

export class DocumentStore {
  private readonly db: SQLite;

  constructor(path = process.env.SQLITE_PATH ?? "crustpad.sqlite") {
    this.db = new SQLite(path, { create: true });
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS document (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        language TEXT,
        operations TEXT,
        last_accessed_at INTEGER NOT NULL DEFAULT 0
      )
    `);
    this.migrate();
  }

  load(documentId: string): PersistedDocument | undefined {
    const row = this.db
      .query<{ text: string; language: string | null }, [string]>(
        "SELECT text, language FROM document WHERE id = ?",
      )
      .get(documentId);

    if (!row) {
      return undefined;
    }

    return {
      text: row.text,
      language: parseLanguage(row.language),
    };
  }

  loadRoomState(documentId: string): StoredRoomState | undefined {
    const row = this.db
      .query<
        { text: string; language: string | null; operations: string | null },
        [string]
      >("SELECT text, language, operations FROM document WHERE id = ?")
      .get(documentId);

    if (!row) {
      return undefined;
    }

    return {
      document: {
        text: row.text,
        language: parseLanguage(row.language),
      },
      operations: parseOperations(row.operations),
    };
  }

  store(
    documentId: string,
    document: PersistedDocument,
    lastAccessedAt = Date.now(),
  ): void {
    this.db
      .query(
        `INSERT INTO document (id, text, language, last_accessed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           text = excluded.text,
           language = excluded.language,
           last_accessed_at = excluded.last_accessed_at`,
      )
      .run(documentId, document.text, document.language, lastAccessedAt);
  }

  storeRoomState(
    documentId: string,
    document: PersistedDocument,
    operations: UserOperation[],
    lastAccessedAt = Date.now(),
  ): void {
    this.db
      .query(
        `INSERT INTO document (id, text, language, operations, last_accessed_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           text = excluded.text,
           language = excluded.language,
           operations = excluded.operations,
           last_accessed_at = excluded.last_accessed_at`,
      )
      .run(
        documentId,
        document.text,
        document.language,
        JSON.stringify(operations),
        lastAccessedAt,
      );
  }

  touch(documentId: string, lastAccessedAt = Date.now()): void {
    this.db
      .query("UPDATE document SET last_accessed_at = ? WHERE id = ?")
      .run(lastAccessedAt, documentId);
  }

  deleteExpired(cutoff: number, activeDocumentIds: string[] = []): number {
    const activeIds = [...new Set(activeDocumentIds)];
    const placeholders = activeIds.map(() => "?").join(", ");
    const activeClause = placeholders.length > 0 ? ` AND id NOT IN (${placeholders})` : "";
    const result = this.db
      .query(`DELETE FROM document WHERE last_accessed_at < ?${activeClause}`)
      .run(cutoff, ...activeIds);

    return result.changes;
  }

  count(): number {
    return (
      this.db.query<{ count: number }, []>("SELECT count(*) AS count FROM document").get()
        ?.count ?? 0
    );
  }

  private migrate(): void {
    const columns = this.db
      .query<{ name: string }, []>("PRAGMA table_info(document)")
      .all()
      .map((column) => column.name);

    if (!columns.includes("operations")) {
      this.db.exec("ALTER TABLE document ADD COLUMN operations TEXT");
    }

    if (!columns.includes("last_accessed_at")) {
      this.db.exec("ALTER TABLE document ADD COLUMN last_accessed_at INTEGER NOT NULL DEFAULT 0");
      this.db
        .query("UPDATE document SET last_accessed_at = ? WHERE last_accessed_at = 0")
        .run(Date.now());
    }
  }
}

function parseLanguage(language: string | null): LanguageId {
  return isLanguageId(language) ? language : "plaintext";
}

function parseOperations(value: string | null): UserOperation[] | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const operations: unknown = JSON.parse(value);
    return isUserOperations(operations) ? operations : undefined;
  } catch {
    return undefined;
  }
}

function isUserOperations(value: unknown): value is UserOperation[] {
  return Array.isArray(value) && value.every(isUserOperation);
}

function isUserOperation(value: unknown): value is UserOperation {
  if (!value || typeof value !== "object") {
    return false;
  }

  const operation = value as Partial<UserOperation>;
  return (
    Number.isSafeInteger(operation.id) &&
    typeof operation.id === "number" &&
    Array.isArray(operation.operation) &&
    operation.operation.every(isOperationComponent)
  );
}

function isOperationComponent(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const component = value as Partial<UserOperation["operation"][number]>;
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
