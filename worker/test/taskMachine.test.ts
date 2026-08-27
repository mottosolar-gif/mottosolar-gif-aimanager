import { describe, expect, it } from "vitest";
import {
  applyTransition,
  deriveOverdue,
  type TaskRow,
} from "../src/taskMachine.ts";
import { applyTaskTransition } from "../src/db/repository.ts";

interface StoredTask {
  id: number;
  task_ref: string;
  title: string;
  description: string | null;
  status: string;
  assignee_person_code: string | null;
  creator_person_code: string | null;
  priority: string;
  scheduled_at: string | null;
  due_at: string | null;
  location_text: string | null;
  location_lat: number | null;
  location_lng: number | null;
  accepted_at: string | null;
  started_at: string | null;
  arrived_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  completion_note: string | null;
  created_at: string;
  updated_at: string;
}

interface StoredTaskEvent {
  task_ref: string;
  actor_person_code: string | null;
  old_status: string;
  new_status: string;
  source: string;
  note: string | null;
  occurred_at: string;
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

  async run<T>(): Promise<D1Result<T>> {
    return this.database.execute(this) as D1Result<T>;
  }
}

class MemoryD1 {
  tasks: StoredTask[] = [];
  taskEvents: StoredTaskEvent[] = [];
  batchCalls = 0;

  seedTask(status: string, taskRef = "TASK-001"): StoredTask {
    const task: StoredTask = {
      id: this.tasks.length + 1,
      task_ref: taskRef,
      title: "Test task",
      description: null,
      status,
      assignee_person_code: "P001",
      creator_person_code: "P002",
      priority: "normal",
      scheduled_at: null,
      due_at: null,
      location_text: null,
      location_lat: null,
      location_lng: null,
      accepted_at: null,
      started_at: null,
      arrived_at: null,
      completed_at: null,
      cancelled_at: null,
      cancel_reason: null,
      completion_note: null,
      created_at: "2026-08-27T00:00:00.000Z",
      updated_at: "2026-08-27T00:00:00.000Z",
    };
    this.tasks.push(task);
    return task;
  }

  prepare(query: string): D1PreparedStatement {
    return new MemoryStatement(this, query) as unknown as D1PreparedStatement;
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    this.batchCalls += 1;
    return statements.map((statement) =>
      this.execute(statement as unknown as MemoryStatement),
    );
  }

  execute(statement: MemoryStatement): D1Result {
    if (/SELECT \* FROM task WHERE task_ref = \?/i.test(statement.query)) {
      const task = this.tasks.find(
        (row) => row.task_ref === String(statement.values[0]),
      );
      return result(task ? [{ ...task }] : []);
    }
    if (/UPDATE task SET/i.test(statement.query)) {
      const guardedByStatus = /WHERE task_ref = \? AND status = \?/i.test(
        statement.query,
      );
      const taskRef = String(statement.values.at(guardedByStatus ? -2 : -1));
      const expectedStatus = guardedByStatus
        ? String(statement.values.at(-1))
        : null;
      const task = this.tasks.find((row) => row.task_ref === taskRef);
      if (!task || (expectedStatus !== null && task.status !== expectedStatus)) {
        return result([], 0);
      }

      const assignments = statement.query
        .slice(statement.query.indexOf("SET") + 3, statement.query.indexOf("WHERE"))
        .split(",")
        .map((assignment) => assignment.trim().split(" = ")[0]);
      assignments.forEach((column, index) => {
        (task as unknown as Record<string, unknown>)[column] = statement.values[index];
      });
      return result([], 1);
    }
    if (/INSERT INTO task_event/i.test(statement.query)) {
      const [taskRef, actor, oldStatus, newStatus, source, note, occurredAt] =
        statement.values;
      this.taskEvents.push({
        task_ref: String(taskRef),
        actor_person_code: actor === null ? null : String(actor),
        old_status: String(oldStatus),
        new_status: String(newStatus),
        source: String(source),
        note: note === null ? null : String(note),
        occurred_at: String(occurredAt),
      });
      return result([], 1);
    }
    throw new Error("Task test D1 received an unsupported statement");
  }
}

function result(rows: unknown[], changes = 0): D1Result {
  return {
    success: true,
    results: rows,
    meta: { changes },
  } as unknown as D1Result;
}

function taskRow(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 1,
    taskRef: "TASK-OVERDUE",
    title: "Overdue test",
    description: null,
    status: "in_progress",
    assigneePersonCode: null,
    creatorPersonCode: null,
    priority: "normal",
    scheduledAt: null,
    dueAt: null,
    locationText: null,
    locationLat: null,
    locationLng: null,
    acceptedAt: null,
    startedAt: null,
    arrivedAt: null,
    completedAt: null,
    cancelledAt: null,
    cancelReason: null,
    completionNote: null,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

describe("task state machine", () => {
  const now = "2026-08-27T08:00:00.000Z";
  const allowed: ReadonlyArray<{
    from: string;
    to: string;
    timestamp?: keyof TaskRow;
  }> = [
    { from: "draft", to: "assigned" },
    { from: "assigned", to: "accepted", timestamp: "acceptedAt" },
    { from: "assigned", to: "rejected" },
    { from: "accepted", to: "en_route", timestamp: "startedAt" },
    { from: "accepted", to: "cancelled", timestamp: "cancelledAt" },
    { from: "en_route", to: "arrived", timestamp: "arrivedAt" },
    { from: "arrived", to: "in_progress" },
    { from: "in_progress", to: "completed", timestamp: "completedAt" },
    { from: "in_progress", to: "blocked" },
    { from: "blocked", to: "in_progress" },
    { from: "blocked", to: "cancelled", timestamp: "cancelledAt" },
  ];

  it.each(allowed)("allows $from -> $to atomically", async ({ from, to, timestamp }) => {
    const database = new MemoryD1();
    database.seedTask(from);
    const note = to === "cancelled" ? "cancel note" : "transition note";

    const updated = await applyTransition(
      database as unknown as D1Database,
      "TASK-001",
      to,
      "P003",
      "web",
      note,
      now,
    );

    expect(updated.status).toBe(to);
    expect(updated.updatedAt).toBe(now);
    if (timestamp) expect(updated[timestamp]).toBe(now);
    if (to === "cancelled") expect(updated.cancelReason).toBe(note);
    if (to === "completed") expect(updated.completionNote).toBe(note);
    expect(database.batchCalls).toBe(0);
    expect(database.taskEvents).toEqual([
      {
        task_ref: "TASK-001",
        actor_person_code: "P003",
        old_status: from,
        new_status: to,
        source: "web",
        note,
        occurred_at: now,
      },
    ]);
  });

  it("rejects a concurrent status change without writing an audit event", async () => {
    const database = new MemoryD1();
    database.seedTask("accepted");
    const current = taskRow({
      taskRef: "TASK-001",
      status: "accepted",
    });
    database.tasks[0].status = "cancelled";

    await expect(
      applyTaskTransition(
        database as unknown as D1Database,
        current,
        "en_route",
        "P003",
        "web",
        null,
        now,
      ),
    ).rejects.toThrow("concurrently");
    expect(database.tasks[0].status).toBe("cancelled");
    expect(database.taskEvents).toHaveLength(0);
    expect(database.batchCalls).toBe(0);
  });

  it.each([
    ["draft", "completed"],
    ["completed", "in_progress"],
    ["rejected", "accepted"],
  ])("rejects %s -> %s without writing", async (from, to) => {
    const database = new MemoryD1();
    database.seedTask(from);
    const before = JSON.stringify(database.tasks);

    await expect(
      applyTransition(
        database as unknown as D1Database,
        "TASK-001",
        to,
        null,
        "system",
        null,
        now,
      ),
    ).rejects.toThrow(`invalid transition: cannot go from '${from}' to '${to}'`);
    expect(JSON.stringify(database.tasks)).toBe(before);
    expect(database.taskEvents).toHaveLength(0);
    expect(database.batchCalls).toBe(0);
  });

  it("derives overdue without storing another status", () => {
    expect(
      deriveOverdue(taskRow({ dueAt: "2026-08-27T07:00:00.000Z" }), now),
    ).toBe(true);
    expect(
      deriveOverdue(taskRow({ dueAt: "2026-08-27T09:00:00.000Z" }), now),
    ).toBe(false);
    expect(
      deriveOverdue(
        taskRow({ dueAt: "2026-08-27T07:00:00.000Z", status: "completed" }),
        now,
      ),
    ).toBe(false);
    expect(deriveOverdue(taskRow({ dueAt: null }), now)).toBe(false);
  });

  it("reports a missing task reference clearly", async () => {
    const database = new MemoryD1();

    await expect(
      applyTransition(
        database as unknown as D1Database,
        "TASK-MISSING",
        "assigned",
        null,
        "system",
        null,
        now,
      ),
    ).rejects.toThrow("task not found: TASK-MISSING");
    expect(database.batchCalls).toBe(0);
    expect(database.taskEvents).toHaveLength(0);
  });
});
