// @ts-expect-error The repo intentionally has no @types/node dependency.
import { readdirSync, readFileSync } from "node:fs";
// @ts-expect-error The repo intentionally has no @types/node dependency.
import { DatabaseSync } from "node:sqlite";

interface SQLiteRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

class SQLiteD1Statement {
  private bindings: unknown[] = [];

  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.bindings = values;
    return this as unknown as D1PreparedStatement;
  }

  async all<T>(): Promise<D1Result<T>> {
    const rows = this.database.prepare(this.sql).all(...this.bindings) as T[];
    return d1Result(rows, 0);
  }

  async run(): Promise<D1Result> {
    const result = this.database.prepare(this.sql).run(...this.bindings) as SQLiteRunResult;
    return d1Result([], result.changes, result.lastInsertRowid);
  }

  async first<T>(columnName?: string): Promise<T | null> {
    const row = this.database.prepare(this.sql).get(...this.bindings) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    return (columnName ? row[columnName] : row) as T;
  }

  getSqliteStatement(): SQLiteD1Statement {
    return this;
  }

  executeBatch(): D1Result {
    const statement = this.database.prepare(this.sql);
    // node:sqlite StatementSync has no columns() in this runtime. insert.all()
    // also returns [] instead of throwing, so we cannot probe by calling all().
    if (sqlReturnsRows(this.sql)) {
      return d1Result(statement.all(...this.bindings), 0);
    }
    const result = statement.run(...this.bindings) as SQLiteRunResult;
    return d1Result([], result.changes, result.lastInsertRowid);
  }
}

function sqlReturnsRows(sql: string): boolean {
  return /^(SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(sql.trimStart());
}

export class SQLiteD1 {
  private readonly database = new DatabaseSync(":memory:");

  constructor() {
    this.database.exec("PRAGMA foreign_keys = ON");
    const migrationDirectory = new URL("../../../schema/migrations/", import.meta.url);
    const migrationFiles = readdirSync(migrationDirectory)
      .filter((file: string) => file.endsWith(".sql"))
      .sort((left: string, right: string) => left.localeCompare(right));
    for (const migrationFile of migrationFiles) {
      this.database.exec(
        readFileSync(new URL(migrationFile, migrationDirectory), "utf8"),
      );
    }
  }

  prepare(sql: string): D1PreparedStatement {
    return new SQLiteD1Statement(this.database, sql) as unknown as D1PreparedStatement;
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    this.database.exec("BEGIN");
    try {
      const results = statements.map((statement) => {
        if (!(statement instanceof SQLiteD1Statement)) {
          throw new Error("SQLiteD1 batch received a statement from another database");
        }
        return statement.getSqliteStatement().executeBatch();
      });
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // Preserve the original statement error if SQLite already ended the transaction.
      }
      throw error;
    }
  }

  exec(sql: string): void {
    this.database.exec(sql);
  }

  close(): void {
    this.database.close();
  }

  asD1(): D1Database {
    return this as unknown as D1Database;
  }
}

function d1Result<T>(
  rows: T[],
  changes: number,
  lastRowId: number | bigint = 0,
): D1Result<T> {
  return {
    success: true,
    results: rows,
    meta: {
      changes,
      last_row_id: Number(lastRowId),
    },
  } as unknown as D1Result<T>;
}
