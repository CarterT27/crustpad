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
        language TEXT
      )
    `);
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

  store(documentId: string, document: PersistedDocument): void {
    this.db
      .query(
        `INSERT INTO document (id, text, language)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           text = excluded.text,
           language = excluded.language`,
      )
      .run(documentId, document.text, document.language);
  }

  count(): number {
    return (
      this.db.query<{ count: number }, []>("SELECT count(*) AS count FROM document").get()
        ?.count ?? 0
    );
  }
}

function parseLanguage(language: string | null): LanguageId {
  return isLanguageId(language) ? language : "plaintext";
}
