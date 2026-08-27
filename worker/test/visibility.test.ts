import { describe, expect, it } from "vitest";
import { canView, readPerson } from "../src/visibility.ts";

interface StoredPerson {
  person_code: string;
  department: string;
  role: string;
}

class MemoryStatement {
  values: unknown[] = [];

  constructor(
    readonly database: MemoryD1,
    readonly query: string,
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values;
    return this as unknown as D1PreparedStatement;
  }

  async all<T>(): Promise<D1Result<T>> {
    return this.database.execute(this) as D1Result<T>;
  }
}

class MemoryD1 {
  people: StoredPerson[] = [];

  seedPerson(personCode: string, department: string, role: string): void {
    this.people.push({
      person_code: personCode,
      department,
      role,
    });
  }

  prepare(query: string): D1PreparedStatement {
    return new MemoryStatement(this, query) as unknown as D1PreparedStatement;
  }

  execute(statement: MemoryStatement): D1Result {
    if (
      /SELECT person_code, department, role FROM person WHERE person_code = \?/i.test(
        statement.query,
      )
    ) {
      const person = this.people.find(
        (row) => row.person_code === String(statement.values[0]),
      );
      return result(person ? [{ ...person }] : []);
    }
    throw new Error("Visibility test D1 received an unsupported statement");
  }
}

function result(rows: unknown[]): D1Result {
  return {
    success: true,
    results: rows,
    meta: { changes: 0 },
  } as unknown as D1Result;
}

function seededDatabase(): MemoryD1 {
  const database = new MemoryD1();
  database.seedPerson("P-OWNER", "management", "owner");
  database.seedPerson("P-MANAGER-A", "operations", "manager");
  database.seedPerson("P-WORKER-A1", "operations", "worker");
  database.seedPerson("P-WORKER-A2", "operations", "worker");
  database.seedPerson("P-WORKER-B", "finance", "worker");
  database.seedPerson("P-GUEST", "operations", "guest");
  database.seedPerson("P-MANAGER-EMPTY", "", "manager");
  database.seedPerson("P-WORKER-EMPTY", "", "worker");
  return database;
}

describe("visibility", () => {
  it("maps a stored person to camelCase", async () => {
    const database = seededDatabase();

    await expect(
      readPerson(database as unknown as D1Database, "P-MANAGER-A"),
    ).resolves.toEqual({
      personCode: "P-MANAGER-A",
      department: "operations",
      role: "manager",
    });
  });

  it("allows an owner to view a person in another department", async () => {
    const database = seededDatabase();

    await expect(
      canView(database as unknown as D1Database, "P-OWNER", "P-WORKER-B"),
    ).resolves.toBe(true);
  });

  it("allows a manager to view a person in the same department", async () => {
    const database = seededDatabase();

    await expect(
      canView(
        database as unknown as D1Database,
        "P-MANAGER-A",
        "P-WORKER-A1",
      ),
    ).resolves.toBe(true);
  });

  it("denies a manager viewing a person in another department", async () => {
    const database = seededDatabase();

    await expect(
      canView(
        database as unknown as D1Database,
        "P-MANAGER-A",
        "P-WORKER-B",
      ),
    ).resolves.toBe(false);
  });

  it("denies visibility when both manager and target departments are empty", async () => {
    const database = seededDatabase();

    await expect(
      canView(
        database as unknown as D1Database,
        "P-MANAGER-EMPTY",
        "P-WORKER-EMPTY",
      ),
    ).resolves.toBe(false);
  });

  it("allows a worker to view themself", async () => {
    const database = seededDatabase();

    await expect(
      canView(
        database as unknown as D1Database,
        "P-WORKER-A1",
        "P-WORKER-A1",
      ),
    ).resolves.toBe(true);
  });

  it("denies a worker viewing another person in the same department", async () => {
    const database = seededDatabase();

    await expect(
      canView(
        database as unknown as D1Database,
        "P-WORKER-A1",
        "P-WORKER-A2",
      ),
    ).resolves.toBe(false);
  });

  it("denies an actor absent from the database even when both codes match", async () => {
    const database = seededDatabase();

    await expect(
      canView(database as unknown as D1Database, "P-MISSING", "P-MISSING"),
    ).resolves.toBe(false);
  });

  it("denies a manager when the target is absent from the database", async () => {
    const database = seededDatabase();

    await expect(
      canView(
        database as unknown as D1Database,
        "P-MANAGER-A",
        "P-MISSING",
      ),
    ).resolves.toBe(false);
  });

  it("treats an unknown role like a worker", async () => {
    const database = seededDatabase();
    const db = database as unknown as D1Database;

    await expect(canView(db, "P-GUEST", "P-GUEST")).resolves.toBe(true);
    await expect(canView(db, "P-GUEST", "P-WORKER-A1")).resolves.toBe(false);
  });
});
