import { Database as SQLite } from "bun:sqlite";
import type { LanguageId, PersistedDocument } from "./protocol";
import { isLanguageId } from "./protocol";

export class DocumentStore {
  private readonly db: SQLite;

  constructor(path = process.env.SQLITE_PATH ?? "crustpad.sqlite") {
    this.db = new SQLite(path, { create: true });
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS document (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        language TEXT,
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

    if (columns.includes("last_accessed_at")) {
      return;
    }

    this.db.exec("ALTER TABLE document ADD COLUMN last_accessed_at INTEGER NOT NULL DEFAULT 0");
    this.db
      .query("UPDATE document SET last_accessed_at = ? WHERE last_accessed_at = 0")
      .run(Date.now());
  }
}

function parseLanguage(language: string | null): LanguageId {
  return isLanguageId(language) ? language : "plaintext";
}
