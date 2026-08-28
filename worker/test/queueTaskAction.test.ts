import { describe, expect, it } from "vitest";
import { processQueue } from "../src/queue.ts";

interface StoredInbox {
  event_id: string;
  postback_data: string | null;
  source_hash: string | null;
  status: string;
}

interface StoredJob {
  id: number;
  event_id: string;
  kind: string;
  status: string;
  attempts: number;
  next_run_at: string;
  last_error: string | null;
}

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

interface StoredLedger {
  action_type: string;
  outcome: string;
  reference_id: string | null;
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
  readonly deadEvents: string[] = [];
  inboxEvents: StoredInbox[] = [];
  jobs: StoredJob[] = [];
  personLinks: Array<{ person_code: string; source_hash: string }> = [];
  tasks: StoredTask[] = [];
  taskEvents: StoredTaskEvent[] = [];
  ledgerRows: StoredLedger[] = [];

  seedEvent(options: {
    eventId: string;
    postbackData: string | null;
    sourceHash?: string | null;
    attempts?: number;
  }): StoredJob {
    this.inboxEvents.push({
      event_id: options.eventId,
      postback_data: options.postbackData,
      source_hash: options.sourceHash ?? "a".repeat(64),
      status: "pending",
    });
    const job: StoredJob = {
      id: this.jobs.length + 1,
      event_id: options.eventId,
      kind: "line_event",
      status: "pending",
      attempts: options.attempts ?? 0,
      next_run_at: "2026-08-27T07:59:00.000Z",
      last_error: null,
    };
    this.jobs.push(job);
    return job;
  }

  seedTask(status: string, taskRef = "T-001"): StoredTask {
    const task: StoredTask = {
      id: this.tasks.length + 1,
      task_ref: taskRef,
      title: "Queue task",
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
    return statements.map((statement) =>
      this.execute(statement as unknown as MemoryStatement),
    );
  }

  execute(statement: MemoryStatement): D1Result {
    if (/SELECT id, event_id, kind, attempts/i.test(statement.query)) {
      const [now, limit] = statement.values;
      return result(
        this.jobs
          .filter(
            (job) =>
              job.status === "pending" && job.next_run_at <= String(now),
          )
          .slice(0, Number(limit))
          .map(({ id, event_id, kind, attempts }) => ({
            id,
            event_id,
            kind,
            attempts,
          })),
      );
    }
    if (/SET status = 'processing'.*status = 'pending'/is.test(statement.query)) {
      const job = this.jobs.find(
        (row) =>
          row.id === Number(statement.values[0]) && row.status === "pending",
      );
      if (job) job.status = "processing";
      return result([], job ? 1 : 0);
    }
    if (/SELECT postback_data, source_hash FROM inbox_event/i.test(statement.query)) {
      const event = this.inboxEvents.find(
        (row) => row.event_id === String(statement.values[0]),
      );
      return result(
        event
          ? [{ postback_data: event.postback_data, source_hash: event.source_hash }]
          : [],
      );
    }
    if (/SELECT person_code FROM person_link/i.test(statement.query)) {
      const link = this.personLinks.find(
        (row) => row.source_hash === String(statement.values[0]),
      );
      return result(link ? [{ person_code: link.person_code }] : []);
    }
    if (/SELECT \* FROM task WHERE task_ref = \?/i.test(statement.query)) {
      const task = this.tasks.find(
        (row) => row.task_ref === String(statement.values[0]),
      );
      return result(task ? [{ ...task }] : []);
    }
    if (/UPDATE task SET/i.test(statement.query)) {
      const taskRef = String(statement.values.at(-2));
      const expectedStatus = String(statement.values.at(-1));
      const task = this.tasks.find(
        (row) => row.task_ref === taskRef && row.status === expectedStatus,
      );
      if (!task) return result([], 0);
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
    if (/UPDATE job_queue SET status = 'done'/i.test(statement.query)) {
      const job = this.jobs.find((row) => row.id === Number(statement.values[0]));
      if (job) job.status = "done";
      return result([], job ? 1 : 0);
    }
    if (/UPDATE inbox_event SET status = 'done'/i.test(statement.query)) {
      const event = this.inboxEvents.find(
        (row) => row.event_id === String(statement.values[0]),
      );
      if (event) event.status = "done";
      return result([], event ? 1 : 0);
    }
    if (/SET status = 'pending', attempts = \?/is.test(statement.query)) {
      const [attempts, nextRunAt, lastError, jobId] = statement.values;
      const job = this.jobs.find((row) => row.id === Number(jobId));
      if (job) {
        job.status = "pending";
        job.attempts = Number(attempts);
        job.next_run_at = String(nextRunAt);
        job.last_error = String(lastError);
      }
      return result([], job ? 1 : 0);
    }
    // ★ 2026-08-28 — killJob ปิดแถวใน inbox_event ตามไปด้วย (เดิมปล่อยค้าง 'pending' ตลอดกาล)
    if (/UPDATE inbox_event SET status = 'dead'/i.test(statement.query)) {
      const [, eventId] = statement.values;
      this.deadEvents.push(String(eventId));
      return result([], 1);
    }
    if (/SET status = 'dead', attempts = \?/is.test(statement.query)) {
      const [attempts, lastError, jobId] = statement.values;
      const job = this.jobs.find((row) => row.id === Number(jobId));
      if (job) {
        job.status = "dead";
        job.attempts = Number(attempts);
        job.last_error = String(lastError);
      }
      return result([], job ? 1 : 0);
    }
    if (/INSERT INTO ledger/i.test(statement.query)) {
      const [actionType, outcome, referenceId] = statement.values;
      this.ledgerRows.push({
        action_type: String(actionType),
        outcome: String(outcome),
        reference_id: referenceId === null ? null : String(referenceId),
      });
      return result([], 1);
    }
    throw new Error("Queue action test D1 received an unsupported statement");
  }
}

function result(rows: unknown[], changes = 0): D1Result {
  return {
    success: true,
    results: rows,
    meta: { changes },
  } as unknown as D1Result;
}

describe("LINE postback task actions", () => {
  const now = "2026-08-27T08:00:00.000Z";
  const sourceHash = "c".repeat(64);

  it("applies an AIM transition using the linked person as the LINE actor", async () => {
    const database = new MemoryD1();
    const task = database.seedTask("assigned");
    const job = database.seedEvent({
      eventId: "evt-accept",
      postbackData: "act=aim_accept&task=T-001",
      sourceHash,
    });
    database.personLinks.push({ person_code: "P001", source_hash: sourceHash });

    const queueResult = await processQueue(database as unknown as D1Database, now);

    expect(queueResult).toEqual({ processed: 1, retried: 0, dead: 0 });
    expect(job.status).toBe("done");
    expect(task.status).toBe("accepted");
    expect(database.taskEvents).toContainEqual(
      expect.objectContaining({
        task_ref: "T-001",
        actor_person_code: "P001",
        old_status: "assigned",
        new_status: "accepted",
        source: "line",
      }),
    );
  });

  it("rejects a postback from someone who is not the task's assignee", async () => {
    const database = new MemoryD1();
    const task = database.seedTask("assigned");
    const job = database.seedEvent({
      eventId: "evt-wrong-assignee",
      postbackData: "act=aim_accept&task=T-001",
      sourceHash,
    });
    database.personLinks.push({ person_code: "P-LINE", source_hash: sourceHash });

    const queueResult = await processQueue(database as unknown as D1Database, now);

    expect(queueResult).toEqual({ processed: 0, retried: 1, dead: 0 });
    expect(task.status).toBe("assigned");
    expect(database.taskEvents).toHaveLength(0);
    expect(job.status).toBe("pending");
    expect(job.last_error).toContain("not authorized");
  });

  it("retries an AIM postback from an unlinked person and records cron_tick", async () => {
    const database = new MemoryD1();
    database.seedTask("assigned");
    const job = database.seedEvent({
      eventId: "evt-unlinked",
      postbackData: "act=aim_accept&task=T-001",
      sourceHash,
    });

    const queueResult = await processQueue(database as unknown as D1Database, now);

    expect(queueResult).toEqual({ processed: 0, retried: 1, dead: 0 });
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(1);
    expect(job.last_error).toBe("unlinked person for postback: " + sourceHash);
    expect(database.ledgerRows).toContainEqual(
      expect.objectContaining({ action_type: "cron_tick", reference_id: "0" }),
    );
  });

  it("sends an invalid task transition to the dead path on the fifth attempt", async () => {
    const database = new MemoryD1();
    const task = database.seedTask("draft");
    const job = database.seedEvent({
      eventId: "evt-invalid-transition",
      postbackData: "act=aim_complete&task=T-001",
      sourceHash,
      attempts: 4,
    });
    database.personLinks.push({ person_code: "P001", source_hash: sourceHash });

    const queueResult = await processQueue(database as unknown as D1Database, now);

    expect(queueResult).toEqual({ processed: 0, retried: 0, dead: 1 });
    expect(job.status).toBe("dead");
    expect(job.attempts).toBe(5);
    expect(job.last_error).toContain("invalid transition");
    // ★ แถวใน inbox_event ต้องถูกปิดตามไปด้วย — ไม่งั้นเหลือ 'pending' ค้างตลอดกาล
    // job บอกว่า "เลิกแล้ว" แต่ inbox บอกว่า "ยังไม่ได้ทำ" = ความจริงสองชุด
    // และ /healthz มองไม่เห็น เพราะมันนับแต่ job ที่ pending ⇒ ของค้างเงียบสนิท (เกิดจริง 27 ส.ค.)
    expect(database.deadEvents).toEqual(["evt-invalid-transition"]);
    expect(task.status).toBe("draft");
    expect(database.taskEvents).toHaveLength(0);
  });

  it("completes a non-AIM postback without touching any task", async () => {
    const database = new MemoryD1();
    const task = database.seedTask("assigned");
    const job = database.seedEvent({
      eventId: "evt-other-action",
      postbackData: "act=constructor&task=T-001",
      sourceHash,
    });

    const queueResult = await processQueue(database as unknown as D1Database, now);

    expect(queueResult).toEqual({ processed: 1, retried: 0, dead: 0 });
    expect(job.status).toBe("done");
    expect(task.status).toBe("assigned");
    expect(database.taskEvents).toHaveLength(0);
  });

  it("keeps ordinary non-postback line events on the existing success path", async () => {
    const database = new MemoryD1();
    const job = database.seedEvent({
      eventId: "evt-message",
      postbackData: null,
      sourceHash,
    });

    const queueResult = await processQueue(database as unknown as D1Database, now);

    expect(queueResult).toEqual({ processed: 1, retried: 0, dead: 0 });
    expect(job.status).toBe("done");
    expect(database.inboxEvents[0].status).toBe("done");
    expect(database.taskEvents).toHaveLength(0);
  });
});
