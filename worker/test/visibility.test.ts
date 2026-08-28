import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canView, readPerson } from "../src/visibility.ts";
import { SQLiteD1 } from "./helpers/sqliteD1.ts";

let database: SQLiteD1;

beforeEach(async () => {
  database = new SQLiteD1();
  await seedPerson("P-OWNER", "management", "owner");
  await seedPerson("P-MANAGER-A", "operations", "manager");
  await seedPerson("P-WORKER-A1", "operations", "worker");
  await seedPerson("P-WORKER-A2", "operations", "worker");
  await seedPerson("P-WORKER-B", "finance", "worker");
  await seedPerson("P-GUEST", "operations", "guest");
  await seedPerson("P-MANAGER-EMPTY", "", "manager");
  await seedPerson("P-WORKER-EMPTY", "", "worker");
});

afterEach(() => {
  database.close();
});

describe("visibility on migrated SQLite schema", () => {
  it("maps a stored person to camelCase through the real readPerson SQL", async () => {
    await expect(readPerson(database.asD1(), "P-MANAGER-A")).resolves.toEqual({
      personCode: "P-MANAGER-A",
      department: "operations",
      role: "manager",
    });
  });

  it("allows an owner to view a person in another department", async () => {
    await expect(canView(database.asD1(), "P-OWNER", "P-WORKER-B")).resolves.toBe(true);
  });

  it("allows a manager to view a person in the same department", async () => {
    await expect(
      canView(database.asD1(), "P-MANAGER-A", "P-WORKER-A1"),
    ).resolves.toBe(true);
  });

  it("denies a manager viewing a person in another department", async () => {
    await expect(
      canView(database.asD1(), "P-MANAGER-A", "P-WORKER-B"),
    ).resolves.toBe(false);
  });

  it("denies visibility when both manager and target departments are empty", async () => {
    await expect(
      canView(database.asD1(), "P-MANAGER-EMPTY", "P-WORKER-EMPTY"),
    ).resolves.toBe(false);
  });

  it("documents that null departments are unreachable through the real schema", async () => {
    // The falsy guard in canView remains defence in depth, but TEXT NOT NULL is
    // the live boundary: a null department cannot be seeded honestly here.
    await expect(
      database
        .asD1()
        .prepare("INSERT INTO person (person_code, department, role) VALUES (?, ?, ?)")
        .bind("P-MANAGER-NULL", null, "manager")
        .run(),
    ).rejects.toThrow();
    await expect(readPerson(database.asD1(), "P-MANAGER-NULL")).resolves.toBeNull();
  });

  it("allows a worker to view themself", async () => {
    await expect(
      canView(database.asD1(), "P-WORKER-A1", "P-WORKER-A1"),
    ).resolves.toBe(true);
  });

  it("denies a worker viewing another person in the same department", async () => {
    await expect(
      canView(database.asD1(), "P-WORKER-A1", "P-WORKER-A2"),
    ).resolves.toBe(false);
  });

  it("denies an actor absent from the database even when both codes match", async () => {
    await expect(canView(database.asD1(), "P-MISSING", "P-MISSING")).resolves.toBe(
      false,
    );
  });

  it("denies a manager when the target is absent from the database", async () => {
    await expect(
      canView(database.asD1(), "P-MANAGER-A", "P-MISSING"),
    ).resolves.toBe(false);
  });

  it("treats an unknown role like a worker", async () => {
    await expect(canView(database.asD1(), "P-GUEST", "P-GUEST")).resolves.toBe(true);
    await expect(canView(database.asD1(), "P-GUEST", "P-WORKER-A1")).resolves.toBe(
      false,
    );
  });
});

async function seedPerson(personCode: string, department: string, role: string): Promise<void> {
  await database
    .asD1()
    .prepare("INSERT INTO person (person_code, department, role) VALUES (?, ?, ?)")
    .bind(personCode, department, role)
    .run();
}
