import { describe, expect, it, vi } from "vitest";
import { handleScheduled } from "../src/index.ts";
import {
  buildSummary,
  MAX_SUMMARY_ROUNDS_PER_TICK,
  processScheduledSummaries,
  runSummaryRoundNow,
  summaryRoundsToProcess,
  type ScheduledSummaryRound,
  type SummaryAsker,
} from "../src/summary.ts";
import type { Env } from "../src/types.ts";
import { SQLiteD1 } from "./helpers/sqliteD1.ts";

const morning: ScheduledSummaryRound = {
  round: "morning",
  date: "28/08/2569",
  scheduledAt: "2026-08-28T01:00:00.000Z",
  delayed: false,
};

function summaryDatabase(
  people: Array<{ code: string; role: "worker" | "manager" | "owner" }> = [
    { code: "P-ASSIST", role: "worker" },
  ],
): SQLiteD1 {
  const database = new SQLiteD1();
  people.forEach((person, index) => {
    database.exec(
      `INSERT INTO person (person_code, department, role)
       VALUES ('${person.code}', 'operations', '${person.role}')`,
    );
    database.exec(
      `INSERT INTO person_link (person_code, source_type, source_hash, linked_at)
       VALUES ('${person.code}', 'user', '${String(index + 1).repeat(64)}', '2026-08-27T00:00:00.000Z')`,
    );
  });
  return database;
}

function seedOpenTask(database: SQLiteD1, personCode = "P-ASSIST"): void {
  database.exec(
    `INSERT INTO task (
       task_ref, title, status, assignee_person_code, creator_person_code,
       priority, due_at, created_at, updated_at
     ) VALUES (
       'T-SUMMARY-${personCode}', 'ตรวจงานสรุป', 'accepted', '${personCode}', '${personCode}',
       'normal', '2026-08-27T00:00:00.000Z',
       '2026-08-27T00:00:00.000Z', '2026-08-27T00:00:00.000Z'
     )`,
  );
}

function seedCronTick(database: SQLiteD1, occurredAt: string): void {
  database.exec(
    `INSERT INTO ledger (action_type, outcome, reference_id, occurred_at, created_at)
     VALUES ('cron_tick', 'ok', '0', '${occurredAt}', '${occurredAt}')`,
  );
}

function failFirstPrepareContaining(database: SQLiteD1, fragment: string): D1Database {
  const base = database.asD1();
  let failed = false;
  return new Proxy(base, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (sql: string): D1PreparedStatement => {
          if (!failed && sql.includes(fragment)) {
            failed = true;
            throw new Error("simulated one-statement D1 failure");
          }
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function expectOnePoliteClosing(text: string): void {
  expect(text.match(/(?:ค่ะ|คะ)(?=\s|$)/gu) ?? []).toHaveLength(1);
  expect(text).toMatch(/ค่ะ$/u);
}

function env(database: SQLiteD1, overrides: Partial<Env> = {}): Env {
  return {
    AIM_ASK_KEY: "ask",
    AIM_LINK_KEY: "link",
    AIM_INGEST_KEY: "ingest",
    AIM_NOTIFY_KEY: "notify",
    AIM_NOTIFY_URL: "https://notify.example/api/aim_notify.php",
    AIM_SOURCE_HASH_SALT: "salt",
    DB: database.asD1(),
    ...overrides,
  };
}

function okResponse(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("summary clock", () => {
  it("selects 08:00 and 17:00 in Thailand and labels catch-up inside 60 minutes", () => {
    expect(summaryRoundsToProcess("2026-08-28T01:00:00.000Z", null)).toEqual({
      rounds: [morning],
      skipped: 0,
    });
    expect(summaryRoundsToProcess("2026-08-28T01:30:00.000Z", null)).toEqual({
      rounds: [{ ...morning, delayed: true }],
      skipped: 0,
    });
    expect(summaryRoundsToProcess("2026-08-28T10:00:00.000Z", null)).toEqual({
      rounds: [{
        round: "evening",
        date: "28/08/2569",
        scheduledAt: "2026-08-28T10:00:00.000Z",
        delayed: false,
      }],
      skipped: 0,
    });
  });

  it("includes every round crossed during downtime instead of silently keeping only the latest", () => {
    expect(
      summaryRoundsToProcess(
        "2026-08-28T11:30:00.000Z",
        "2026-08-27T00:00:00.000Z",
      ).rounds.map((round) => `${round.date}:${round.round}`),
    ).toEqual([
      "27/08/2569:morning",
      "27/08/2569:evening",
      "28/08/2569:morning",
      "28/08/2569:evening",
    ]);
  });
});

describe("summary composition", () => {
  it("uses the existing askQuestion engine and closes with one polite particle", async () => {
    const database = summaryDatabase();
    seedOpenTask(database);
    try {
      const summary = await buildSummary(
        database.asD1(),
        "P-ASSIST",
        morning,
        morning.scheduledAt,
      );
      expect(summary.status).toBe("ready");
      if (summary.status !== "ready") throw new Error("expected a ready summary");
      expect(summary.text).toContain("T-SUMMARY-P-ASSIST");
      expect(summary.text).toContain("งานที่เกินกำหนดแล้ว");
      expect(summary.text).not.toContain("คำถามข้อมูลทีมใช้ได้เฉพาะ");
      expectOnePoliteClosing(summary.text);
    } finally {
      database.close();
    }
  });

  it("returns empty when every permitted answer says there is nothing to report", async () => {
    const database = summaryDatabase();
    try {
      await expect(
        buildSummary(database.asD1(), "P-ASSIST", morning, morning.scheduledAt),
      ).resolves.toEqual({ status: "empty" });
    } finally {
      database.close();
    }
  });

  it.each([
    [
      "denied",
      async () => ({
        intent: "my_open",
        text: "denied",
        matched: true,
        denied: true,
      }),
    ],
    ["error", async () => Promise.reject(new Error("database unavailable"))],
  ] as const)("does not turn an askQuestion %s into a blank summary", async (_case, asker) => {
    const database = summaryDatabase();
    try {
      await expect(
        buildSummary(
          database.asD1(),
          "P-ASSIST",
          morning,
          morning.scheduledAt,
          asker as SummaryAsker,
        ),
      ).resolves.toEqual({ status: "error" });
    } finally {
      database.close();
    }
  });
});

describe("scheduled summary delivery", () => {
  it("leaves a ledger failure and does not advance cron_tick when the summary pass fails", async () => {
    const database = summaryDatabase();
    const failingDb = failFirstPrepareContaining(
      database,
      "SELECT DISTINCT person.person_code",
    );
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await handleScheduled(
        { ...env(database), DB: failingDb },
        morning.scheduledAt,
      );
      const ledger = await database
        .asD1()
        .prepare(
          `SELECT action_type, outcome, reference_id FROM ledger ORDER BY id`,
        )
        .all<{ action_type: string; outcome: string; reference_id: string }>();
      expect(ledger.results).toEqual([
        {
          action_type: "scheduled_summary_pass",
          outcome: "pass_error",
          reference_id: `cron:${morning.scheduledAt}`,
        },
      ]);
    } finally {
      vi.restoreAllMocks();
      database.close();
    }
  });

  it("claims in D1 so five cron invocations in the same minute send once", async () => {
    const database = summaryDatabase();
    seedOpenTask(database);
    const fetcher = vi.fn(async () => okResponse());
    try {
      await Promise.all(
        Array.from({ length: 5 }, () =>
          processScheduledSummaries(
            env(database),
            morning.scheduledAt,
            fetcher,
          ),
        ),
      );

      expect(fetcher).toHaveBeenCalledTimes(1);
      const ledger = await database
        .asD1()
        .prepare(
          `SELECT outcome FROM ledger
           WHERE action_type = 'scheduled_summary' AND reference_id = '28/08/2569:morning'`,
        )
        .all<{ outcome: string }>();
      expect(ledger.results).toEqual([{ outcome: "sent" }]);
    } finally {
      database.close();
    }
  });

it("บันทึกวันหยุดเป็น skipped_holiday แล้วไม่ยิงซ้ำอีกในรอบเดียวกัน", async () => {
    const database = summaryDatabase();
    seedOpenTask(database);
    // ฝั่งรับตอบ 412 = "วันนี้ผู้รับหยุด ไม่ส่งให้" — ไม่ใช่ความล้มเหลว
    const fetcher = vi.fn(async () => new Response("off", { status: 412 }));
    try {
      const first = await processScheduledSummaries(env(database), morning.scheduledAt, fetcher);
      expect(first.skippedHoliday).toBe(1);
      expect(first.dead).toBe(0);
      expect(first.retried).toBe(0);
      // ข้ามเพราะวันหยุด = งานรอบนี้จบแล้วจริง ๆ ⇒ ห้ามหน่วง checkpoint ไว้ตามเก็บ
      expect(first.checkpointSafe).toBe(true);

      // รอบถัดไปในนาทีเดียวกันต้องไม่ยิงซ้ำ — ถ้าไม่เป็น terminal จะโดนยิงทุกนาทีทั้งวัน
      const second = await processScheduledSummaries(env(database), morning.scheduledAt, fetcher);
      expect(second.skippedHoliday).toBe(0);
      expect(fetcher).toHaveBeenCalledTimes(1);

      const ledger = await database
        .asD1()
        .prepare(
          `SELECT outcome FROM ledger
           WHERE action_type = 'scheduled_summary' AND reference_id = '28/08/2569:morning'`,
        )
        .all<{ outcome: string }>();
      expect(ledger.results).toEqual([{ outcome: "skipped_holiday" }]);
    } finally {
      database.close();
    }
  });

it("สั่งยิงเองได้แม้รอบจะสายไปแล้ว และไม่ทับผลของรอบตามเวลา", async () => {
    const database = summaryDatabase();
    seedOpenTask(database);
    const fetcher = vi.fn(async () => okResponse());
    // สายไป 6 ชั่วโมง — รอบตามเวลาจะตัดสินว่า missed แน่นอน
    const lateNow = new Date(Date.parse(morning.scheduledAt) + 6 * 60 * 60_000).toISOString();
    try {
      const scheduled = await processScheduledSummaries(env(database), lateNow, fetcher);
      expect(scheduled.sent).toBe(0);
      expect(scheduled.missed).toBe(1);
      expect(fetcher).not.toHaveBeenCalled();

      const manual = await runSummaryRoundNow(env(database), "morning", lateNow, fetcher);
      expect(manual.sent).toBe(1);
      expect(fetcher).toHaveBeenCalledTimes(1);

      // ผลของรอบตามเวลาต้องยังเป็น missed เหมือนเดิม — การยิงเองห้ามไปเขียนทับประวัติ
      const rows = await database
        .asD1()
        .prepare(
          `SELECT reference_id, outcome FROM ledger
           WHERE action_type = 'scheduled_summary' ORDER BY reference_id`,
        )
        .all<{ reference_id: string; outcome: string }>();
      expect(rows.results).toEqual([
        { reference_id: "28/08/2569:morning", outcome: "missed" },
        { reference_id: "manual:28/08/2569:morning", outcome: "sent" },
      ]);
    } finally {
      database.close();
    }
  });

  it("สั่งยิงเองซ้ำรอบเดิมไม่ส่งซ้ำ — ปุ่มฉุกเฉินไม่ปิดตัวกันซ้ำ", async () => {
    const database = summaryDatabase();
    seedOpenTask(database);
    const fetcher = vi.fn(async () => okResponse());
    try {
      const first = await runSummaryRoundNow(env(database), "morning", morning.scheduledAt, fetcher);
      const second = await runSummaryRoundNow(env(database), "morning", morning.scheduledAt, fetcher);
      expect(first.sent).toBe(1);
      expect(second.sent).toBe(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      database.close();
    }
  });

  it("สั่งยิงเองยังผ่านด่านปฏิทินวันหยุด — ปุ่มฉุกเฉินไม่ปิดด่านความปลอดภัย", async () => {
    const database = summaryDatabase();
    seedOpenTask(database);
    const fetcher = vi.fn(async () => new Response("off", { status: 412 }));
    try {
      const result = await runSummaryRoundNow(env(database), "morning", morning.scheduledAt, fetcher);
      expect(result.sent).toBe(0);
      expect(result.skippedHoliday).toBe(1);
    } finally {
      database.close();
    }
  });

  it("sends to every linked person and no unlinked person", async () => {
    const database = summaryDatabase([
      { code: "P-EKAPUN", role: "owner" },
      { code: "P-ASSIST", role: "worker" },
    ]);
    seedOpenTask(database, "P-EKAPUN");
    seedOpenTask(database, "P-ASSIST");
    database.exec(
      "INSERT INTO person (person_code, department, role) VALUES ('P-NOLINK', 'operations', 'worker')",
    );
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return okResponse();
    });
    try {
      const result = await processScheduledSummaries(
        env(database),
        morning.scheduledAt,
        fetcher,
      );
      expect(result.sent).toBe(2);
      expect(bodies.map((body) => body.person_code).sort()).toEqual([
        "P-ASSIST",
        "P-EKAPUN",
      ]);
      expect(JSON.stringify(bodies)).not.toContain("P-NOLINK");
    } finally {
      database.close();
    }
  });

  it("isolates one person's D1 failure and continues with the remaining people", async () => {
    const database = summaryDatabase([
      { code: "P-ASSIST", role: "worker" },
      { code: "P-EKAPUN", role: "owner" },
    ]);
    seedOpenTask(database, "P-ASSIST");
    seedOpenTask(database, "P-EKAPUN");
    const fetcher = vi.fn(async () => okResponse());
    const failingDb = failFirstPrepareContaining(database, "SELECT outcome, occurred_at");
    try {
      const result = await processScheduledSummaries(
        { ...env(database), DB: failingDb },
        morning.scheduledAt,
        fetcher,
      );
      expect(result).toMatchObject({ sent: 1, retried: 1, checkpointSafe: false });
      expect(fetcher).toHaveBeenCalledTimes(1);
      const ledger = await database
        .asD1()
        .prepare(
          `SELECT action_type, outcome, actor_code FROM ledger ORDER BY id`,
        )
        .all<{ action_type: string; outcome: string; actor_code: string }>();
      expect(ledger.results).toEqual([
        {
          action_type: "scheduled_summary_error",
          outcome: "retry",
          actor_code: "P-ASSIST",
        },
        {
          action_type: "scheduled_summary",
          outcome: "sent",
          actor_code: "P-EKAPUN",
        },
      ]);
    } finally {
      database.close();
    }
  });

  it("records no-data as empty without calling the outbound endpoint", async () => {
    const database = summaryDatabase();
    const fetcher = vi.fn(async () => okResponse());
    try {
      const empty = await processScheduledSummaries(
        env(database),
        morning.scheduledAt,
        fetcher,
      );
      expect(empty.empty).toBe(1);
      expect(fetcher).not.toHaveBeenCalled();
      const rows = await database
        .asD1()
        .prepare(
          `SELECT outcome FROM ledger
           WHERE action_type = 'scheduled_summary' AND actor_code = 'P-ASSIST'`,
        )
        .all<{ outcome: string }>();
      expect(rows.results).toEqual([{ outcome: "empty" }]);
    } finally {
      database.close();
    }
  });

  it.each([
    [
      "denied",
      async () => ({
        intent: "my_open",
        text: "denied",
        matched: true,
        denied: true,
      }),
    ],
    ["error", async () => Promise.reject(new Error("simulated askQuestion failure"))],
  ] as const)(
    "never sends an empty notification when askQuestion returns %s",
    async (_case, asker) => {
      const database = summaryDatabase();
      const fetcher = vi.fn(async () => okResponse());
      try {
        const failed = await processScheduledSummaries(
          env(database),
          morning.scheduledAt,
          fetcher,
          asker as SummaryAsker,
        );
        expect(failed.retried).toBe(1);
        expect(fetcher).not.toHaveBeenCalled();
        const rows = await database
          .asD1()
          .prepare(
            `SELECT outcome FROM ledger
             WHERE action_type = 'scheduled_summary' AND actor_code = 'P-ASSIST'`,
          )
          .all<{ outcome: string }>();
        expect(rows.results).toEqual([{ outcome: "retry:summary_error" }]);
      } finally {
        database.close();
      }
    },
  );

  it("sends at the 60-minute boundary, but records a miss after the window", async () => {
    const catchupDatabase = summaryDatabase();
    const missedDatabase = summaryDatabase();
    seedOpenTask(catchupDatabase);
    seedOpenTask(missedDatabase);
    const bodies: string[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return okResponse();
    });
    try {
      const catchup = await processScheduledSummaries(
        env(catchupDatabase),
        "2026-08-28T02:00:00.000Z",
        fetcher,
      );
      const missed = await processScheduledSummaries(
        env(missedDatabase),
        "2026-08-28T02:00:01.000Z",
        fetcher,
      );
      expect(catchup.sent).toBe(1);
      expect(bodies[0]).toContain("สรุปย้อนหลังรอบเช้า 08:00");
      expect(missed.missed).toBe(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
      const missedRows = await missedDatabase
        .asD1()
        .prepare(
          `SELECT outcome, reference_id FROM ledger
           WHERE action_type = 'scheduled_summary' AND actor_code = 'P-ASSIST'`,
        )
        .all<{ outcome: string; reference_id: string }>();
      expect(missedRows.results).toEqual([
        { outcome: "missed", reference_id: "28/08/2569:morning" },
      ]);
    } finally {
      catchupDatabase.close();
      missedDatabase.close();
    }
  });

  it.each([
    ["AIM_NOTIFY_KEY", { AIM_NOTIFY_KEY: "" }],
    ["AIM_NOTIFY_URL", { AIM_NOTIFY_URL: "" }],
  ] as const)(
    "keeps a missing %s recoverable instead of writing a terminal person outcome",
    async (_field, overrides) => {
      const database = summaryDatabase();
      seedOpenTask(database);
      const fetcher = vi.fn(async () => okResponse());
      try {
        const blocked = await processScheduledSummaries(
          env(database, overrides),
          morning.scheduledAt,
          fetcher,
        );
        await processScheduledSummaries(env(database, overrides), morning.scheduledAt, fetcher);
        expect(blocked).toMatchObject({ configMissing: 1, checkpointSafe: false });
        expect(fetcher).not.toHaveBeenCalled();
        const rows = await database
          .asD1()
          .prepare(
            `SELECT action_type, outcome FROM ledger ORDER BY id`,
          )
          .all<{ action_type: string; outcome: string }>();
        expect(rows.results).toEqual([
          { action_type: "scheduled_summary_pass", outcome: "config_missing" },
        ]);

        const recovered = await processScheduledSummaries(
          env(database),
          morning.scheduledAt,
          fetcher,
        );
        expect(recovered).toMatchObject({ sent: 1, checkpointSafe: true });
        expect(fetcher).toHaveBeenCalledTimes(1);
      } finally {
        database.close();
      }
    },
  );

  it("reclaims a stale crash claim inside the delivery window", async () => {
    const database = summaryDatabase();
    seedOpenTask(database);
    seedCronTick(database, "2026-08-28T00:59:00.000Z");
    database.exec(
      `INSERT INTO ledger (
         action_type, outcome, reference_id, actor_code, occurred_at, created_at
       ) VALUES (
         'scheduled_summary', 'processing', '28/08/2569:morning', 'P-ASSIST',
         '2026-08-28T01:00:00.000Z', '2026-08-28T01:00:00.000Z'
       )`,
    );
    const fetcher = vi.fn(async () => okResponse());
    try {
      const result = await processScheduledSummaries(
        env(database),
        "2026-08-28T01:16:00.000Z",
        fetcher,
      );
      expect(result).toMatchObject({ sent: 1, missed: 0, checkpointSafe: true });
      expect(fetcher).toHaveBeenCalledTimes(1);
      const rows = await database
        .asD1()
        .prepare(
          `SELECT outcome FROM ledger
           WHERE action_type = 'scheduled_summary' ORDER BY id`,
        )
        .all<{ outcome: string }>();
      expect(rows.results.map((row) => row.outcome)).toEqual(["processing", "sent"]);
    } finally {
      database.close();
    }
  });

  it("turns a stale crash claim into an explicit missed outcome after the window", async () => {
    const database = summaryDatabase();
    seedCronTick(database, "2026-08-28T00:59:00.000Z");
    database.exec(
      `INSERT INTO ledger (
         action_type, outcome, reference_id, actor_code, occurred_at, created_at
       ) VALUES (
         'scheduled_summary', 'processing', '28/08/2569:morning', 'P-ASSIST',
         '2026-08-28T01:40:00.000Z', '2026-08-28T01:40:00.000Z'
       )`,
    );
    const fetcher = vi.fn(async () => okResponse());
    try {
      const result = await processScheduledSummaries(
        env(database),
        "2026-08-28T02:01:00.000Z",
        fetcher,
      );
      expect(result.missed).toBe(1);
      expect(fetcher).not.toHaveBeenCalled();
      const rows = await database
        .asD1()
        .prepare(
          `SELECT outcome FROM ledger
           WHERE action_type = 'scheduled_summary' ORDER BY id`,
        )
        .all<{ outcome: string }>();
      expect(rows.results.map((row) => row.outcome)).toEqual(["processing", "missed"]);
    } finally {
      database.close();
    }
  });

  it("uses the cron_tick checkpoint, caps catch-up, and records the exact skipped count", async () => {
    const database = summaryDatabase();
    seedCronTick(database, "2026-08-27T00:00:00.000Z");
    const fetcher = vi.fn(async () => okResponse());
    try {
      const result = await processScheduledSummaries(
        env(database),
        "2026-08-30T11:30:00.000Z",
        fetcher,
      );
      expect(result.missed).toBe(MAX_SUMMARY_ROUNDS_PER_TICK);
      expect(fetcher).not.toHaveBeenCalled();
      const catchup = await database
        .asD1()
        .prepare(
          `SELECT action_type, outcome, reference_id FROM ledger
           WHERE action_type = 'scheduled_summary_catchup'`,
        )
        .all<{ action_type: string; outcome: string; reference_id: string }>();
      expect(catchup.results).toEqual([
        {
          action_type: "scheduled_summary_catchup",
          outcome: "skipped",
          reference_id: "4",
        },
      ]);
      const missed = await database
        .asD1()
        .prepare(
          `SELECT COUNT(*) AS count FROM ledger
           WHERE action_type = 'scheduled_summary' AND outcome = 'missed'`,
        )
        .first<{ count: number }>();
      expect(missed?.count).toBe(MAX_SUMMARY_ROUNDS_PER_TICK);
    } finally {
      database.close();
    }
  });

  it("marks a permanent 404 dead immediately and does not retry it", async () => {
    const database = summaryDatabase();
    seedOpenTask(database);
    const fetcher = vi.fn(async () => new Response("missing", { status: 404 }));
    try {
      const first = await processScheduledSummaries(
        env(database),
        morning.scheduledAt,
        fetcher,
      );
      const second = await processScheduledSummaries(
        env(database),
        "2026-08-28T01:01:00.000Z",
        fetcher,
      );
      expect(first).toMatchObject({ dead: 1, retried: 0, checkpointSafe: true });
      expect(second).toMatchObject({ dead: 0, retried: 0, checkpointSafe: true });
      expect(fetcher).toHaveBeenCalledTimes(1);
      const outcomes = await database
        .asD1()
        .prepare(
          `SELECT outcome FROM ledger
           WHERE action_type = 'scheduled_summary' ORDER BY id`,
        )
        .all<{ outcome: string }>();
      expect(outcomes.results.map((row) => row.outcome)).toEqual(["dead:http_404"]);
    } finally {
      database.close();
    }
  });

  it("backs off three failed attempts and marks the next failure dead", async () => {
    const database = summaryDatabase();
    seedOpenTask(database);
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false }), { status: 503 }),
    );
    try {
      const first = await processScheduledSummaries(
        env(database),
        "2026-08-28T01:00:00.000Z",
        fetcher,
      );
      const tooSoon = await processScheduledSummaries(
        env(database),
        "2026-08-28T01:00:30.000Z",
        fetcher,
      );
      const second = await processScheduledSummaries(
        env(database),
        "2026-08-28T01:01:00.000Z",
        fetcher,
      );
      const third = await processScheduledSummaries(
        env(database),
        "2026-08-28T01:03:00.000Z",
        fetcher,
      );
      const fourth = await processScheduledSummaries(
        env(database),
        "2026-08-28T01:07:00.000Z",
        fetcher,
      );

      expect(first.retried).toBe(1);
      expect(tooSoon).toMatchObject({ retried: 0, dead: 0 });
      expect(second.retried).toBe(1);
      expect(third.retried).toBe(1);
      expect(fourth.dead).toBe(1);
      expect(fetcher).toHaveBeenCalledTimes(4);
      const outcomes = await database
        .asD1()
        .prepare(
          `SELECT outcome FROM ledger
           WHERE action_type = 'scheduled_summary' ORDER BY id`,
        )
        .all<{ outcome: string }>();
      expect(outcomes.results.map((row) => row.outcome)).toEqual([
        "retry:http_503",
        "retry:http_503",
        "retry:http_503",
        "dead:http_503",
      ]);
    } finally {
      database.close();
    }
  });
});
