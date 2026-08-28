import { afterEach, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error The repo intentionally has no @types/node dependency.
import { readFileSync } from "node:fs";
import {
  askQuestion,
  matchQuestionIntent,
  registeredIntents,
  thaiDayRange,
  thaiDisplayTime,
  thaiMonthRange,
  thaiWeekRange,
} from "../src/queryEngine.ts";
import { SQLiteD1 } from "./helpers/sqliteD1.ts";

const now = "2026-08-27T09:00:00.000Z";

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

interface TaskSeed {
  ref: string;
  title: string;
  status: string;
  assignee: string | null;
  createdAt: string;
  dueAt?: string;
  acceptedAt?: string;
  completedAt?: string;
}

let database: SQLiteD1;

beforeEach(async () => {
  database = new SQLiteD1();
  await seedScenario(database);
});

afterEach(() => {
  database.close();
});

describe("Thai UTC ranges", () => {
  it("pins Thai day, Monday-start week, and month boundaries", () => {
    expect(thaiDayRange(now)).toEqual({
      startUtc: "2026-08-26T17:00:00.000Z",
      endUtc: "2026-08-27T17:00:00.000Z",
    });
    expect(thaiWeekRange(now)).toEqual({
      startUtc: "2026-08-23T17:00:00.000Z",
      endUtc: "2026-08-30T17:00:00.000Z",
    });
    expect(thaiMonthRange(now)).toEqual({
      startUtc: "2026-07-31T17:00:00.000Z",
      endUtc: "2026-08-31T17:00:00.000Z",
    });
  });

  it("formats Bangkok time across a UTC day boundary", () => {
    expect(thaiDisplayTime("2026-08-27T17:30:00.000Z")).toBe(
      "28 ส.ค. 2569 00:30 น.",
    );
  });
});

describe("SQLite D1 adapter", () => {
  it("uses the migrated schema and supports first, run, and atomic batch results", async () => {
    const person = await database
      .asD1()
      .prepare("SELECT person_code FROM person WHERE person_code = ?")
      .bind("P-W1")
      .first<{ person_code: string }>();
    expect(person).toEqual({ person_code: "P-W1" });

    const results = await database.asD1().batch([
      database
        .asD1()
        .prepare(
          "INSERT INTO ledger (action_type, outcome, occurred_at) VALUES ('adapter_test', 'ok', ?)",
        )
        .bind("2026-08-27T09:00:01.000Z"),
      database
        .asD1()
        .prepare(
          "INSERT INTO ledger (action_type, outcome, occurred_at) VALUES ('adapter_test', 'ok', ?)",
        )
        .bind("2026-08-27T09:00:02.000Z"),
    ]);

    expect(results.map((result) => result.meta.changes)).toEqual([1, 1]);
    const count = await database
      .asD1()
      .prepare("SELECT COUNT(*) AS count FROM ledger WHERE action_type = 'adapter_test'")
      .first<number>("count");
    expect(count).toBe(2);
  });
});

const canonicalMenuCases: Array<[string, string]> = [
  ["งานของฉันมีอะไรบ้าง", "my_tasks"],
  ["งานที่ค้างอยู่ตอนนี้", "my_open"],
  ["งานที่เกินกำหนดแล้ว", "my_overdue"],
  ["งานที่เสร็จวันนี้", "my_done_today"],
  ["งานที่เสร็จสัปดาห์นี้", "my_done_week"],
  ["งานถัดไปที่ต้องทำ", "my_next"],
  ["งานล่าสุดที่ได้รับมอบหมาย", "my_latest_assigned"],
  ["ใครยังไม่รับงาน", "team_unaccepted"],
  ["ใครมีงานค้างมากที่สุด", "team_most_open"],
  ["งานที่เกินกำหนดของทีม", "team_overdue"],
  ["สรุปงานวันนี้ทั้งทีม", "team_today"],
  ["ใครปฏิเสธงานบ้าง", "team_rejected"],
  ["งานที่ยังไม่มีคนรับ", "team_unassigned"],
  ["งานเสร็จกี่ใบเดือนนี้", "stats_completed_month"],
  ["งานถูกปฏิเสธกี่ใบเดือนนี้", "stats_rejected_month"],
  ["เวลาเฉลี่ยตั้งแต่รับงานถึงเสร็จงาน", "stats_avg_cycle"],
  ["ใครรับงานเร็วที่สุด", "stats_fastest_accept"],
  ["วันนี้มีงานใหม่กี่ใบ", "stats_new_today"],
  ["AI ช่วยอะไรได้บ้าง", "help"],
  ["สถานะระบบ", "system_status"],
];

const realisticPhraseCases: Array<[string, string]> = [
  ["งานของฉัน", "my_tasks"],
  ["งานค้าง", "my_open"],
  ["งานเกินกำหนด", "my_overdue"],
  ["งานฉันมีอะไรบ้าง", "my_tasks"],
  ["ฉันมีงานค้างกี่งาน", "my_open"],
  ["งานที่เลยกำหนด", "my_overdue"],
  ["มีงานอะไรบ้าง", "my_tasks"],
  ["งานถัดไป", "my_next"],
  ["วันนี้เสร็จกี่งาน", "my_done_today"],
  ["ใครยังไม่รับ", "team_unaccepted"],
  ["ใครงานค้างเยอะ", "team_most_open"],
  ["สรุปวันนี้", "my_done_today"],
  ["ใครปฏิเสธ", "team_rejected"],
  ["เมนูคำถาม", "help"],
  ["สถานะระบบ", "system_status"],
  ["งานว่าง", "team_unassigned"],
  ["สัปดาห์นี้เสร็จกี่งาน", "my_done_week"],
  ["งานล่าสุด", "my_latest_assigned"],
  ["ทีมงานเกินกำหนด", "team_overdue"],
  ["เดือนนี้เสร็จกี่งาน", "stats_completed_month"],
  ["เดือนนี้ปฏิเสธกี่งาน", "stats_rejected_month"],
  ["เฉลี่ยใช้เวลากี่นาที", "stats_avg_cycle"],
  ["ใครรับเร็วสุด", "stats_fastest_accept"],
  ["วันนี้งานใหม่กี่งาน", "stats_new_today"],
];

const negativePhraseCases = [
  "สวัสดีค่ะ",
  "ขอบคุณค่ะ",
  "ลาป่วยพรุ่งนี้",
  "เบิกเครื่องมือ",
  "ลงเวลา",
  "5ส วันนี้",
  "ok",
  "งานเสร็จแล้วครับ",
  "ค้างจ่ายอยู่ตอนนี้เท่าไหร่",
  "เกินกำหนดชำระเงินแล้วครับ",
  "เอกสารเกินกำหนดส่งแล้ว",
  "overdue payment reminder",
  "ใครยังไม่รับเงินเดือน",
  "ใครยังไม่รับของที่หน้าโรงงาน",
  "ใครไม่รับสายครับ",
  "ประชุมเสร็จเดือนนี้",
  "เฉลี่ยใช้เวลาเดินทางกี่นาที",
  "สรุปประชุมวันนี้",
  "สรุปว่าวันนี้หยุดนะครับ",
  "สรุปยอดของเข้าวันนี้",
  "เมนูอาหารกลางวันวันนี้",
  "เมนูใหม่ในแอปอยู่ตรงไหน",
  "ปิดเมนูวันหยุดให้หน่อย",
  "งานว่างเปล่าไม่มีคนทำ",
  "งานล่าสุดที่ทำคือติดตั้งประตู",
  "พรุ่งนี้งานถัดไปคือติดตั้งเครน",
  "งานฉันเสร็จแล้วครับ",
  "วันนี้ทำงานเสร็จหมดแล้วครับ",
  "ไม่มีงานค้างแล้วครับ",
];

const shadowingRegressionCases: Array<[string, string | null]> = [
  ["สถานะงานของฉันตอนนี้เป็นยังไง", "my_tasks"],
  ["งานของฉันสถานะอะไรบ้าง", "my_tasks"],
  ["ขอดูสถานะงาน T-123 หน่อย", null],
  ["สถานะการเบิกเครื่องมือ", null],
  ["เมนูอาหารกลางวันวันนี้", null],
  ["สถานะระบบ", "system_status"],
  ["AI ช่วยอะไรได้บ้าง", "help"],
];

describe("ordered pattern matching", () => {
  it.each(realisticPhraseCases)(
    "matches realistic phrase %s exactly as %s",
    (phrase, expectedIntent) => {
      expect(matchQuestionIntent(`  ${phrase}  `)).toBe(expectedIntent);
    },
  );

  it.each(canonicalMenuCases)("keeps menu text %s mapped to %s", (phrase, expectedIntent) => {
    expect(matchQuestionIntent(`  ${phrase}  `)).toBe(expectedIntent);
  });

  it("keeps all 20 canonical menu mappings as explicit regressions", () => {
    expect(canonicalMenuCases).toHaveLength(20);
  });

  it.each(shadowingRegressionCases)(
    "does not let a general utility intent shadow %s",
    (phrase, expectedIntent) => {
      expect(matchQuestionIntent(phrase)).toBe(expectedIntent);
    },
  );

  it.each([
    ["งานค้างของทีมมีกี่ใบ", "team_most_open"],
    ["ทีมมีงานอะไรบ้างวันนี้", "team_today"],
    ["สรุปงานวันนี้ทั้งทีม", "team_today"],
    ["ใครไม่รับงานบ้าง", "team_unaccepted"],
  ])("routes team-scoped phrase %s to %s", (phrase, expectedIntent) => {
    expect(matchQuestionIntent(phrase)).toBe(expectedIntent);
  });

  const politenessParticles = [
    "ครับ",
    "ครับผม",
    "ค่ะ",
    "คะ",
    "นะคะ",
    "นะครับ",
    "จ้า",
    "ฮะ",
  ];

  it.each(politenessParticles)(
    "keeps a team question team-scoped with attached politeness particle %s",
    (particle) => {
      expect(matchQuestionIntent(`ใครยังไม่รับงาน${particle}`)).toBe(
        "team_unaccepted",
      );
    },
  );

  it.each([
    ["ใครยังไม่รับงานครับผม?", "team_unaccepted"],
    ["ครับผม ใครมีงานค้างมากที่สุด", "team_most_open"],
    ["…ครับ ครับผม", null],
  ])("strips repeated politeness and trailing punctuation in %s", (phrase, intent) => {
    expect(matchQuestionIntent(phrase)).toBe(intent);
  });

  it.each(politenessParticles)(
    "keeps a self question self-scoped with attached politeness particle %s",
    (particle) => {
      expect(matchQuestionIntent(`งานของฉันมีอะไรบ้าง${particle}`)).toBe("my_tasks");
    },
  );

  it.each([
    ["ขอสรุปงานวันนี้ของฉัน", null],
    ["ขอสรุปงานวันนี้ของผม", null],
    ["ขอสรุปงานวันนี้ของหนู", null],
    ["ฉันขอสรุปงานวันนี้", null],
    ["ผมขอสรุปงานวันนี้", null],
    ["สรุปงานที่เสร็จวันนี้", "my_done_today"],
  ])("never routes self-scoped phrase %s to a team intent", (phrase, expectedIntent) => {
    expect(matchQuestionIntent(phrase)).toBe(expectedIntent);
  });

  it.each([
    ["งานค้างของฉันใครสั่งมา", "my_open"],
    ["งานค้างของฉันคนไหนสั่งมา", "my_open"],
    ["ใครยังไม่รับงานที่ผมมอบหมาย", null],
  ])(
    "lets first-person scope beat the bare interrogative in %s",
    (phrase, expectedIntent) => {
      expect(matchQuestionIntent(phrase)).toBe(expectedIntent);
    },
  );

  it.each([
    ["งานเกินกำหนดของทีมผม", "team_overdue"],
    ["วันนี้ทีมของผมมีงานอะไรบ้าง", "team_today"],
    ["งานค้างของทีมผม", "team_most_open"],
    ["ทีมผมใครมีงานค้างเยอะสุด", "team_most_open"],
  ])("lets an explicit team cue win in %s", (phrase, expectedIntent) => {
    expect(matchQuestionIntent(phrase)).toBe(expectedIntent);
  });

  it("routes both natural bare daily-summary forms to the actor", () => {
    expect(matchQuestionIntent("สรุปงานวันนี้")).toBe("my_done_today");
    expect(matchQuestionIntent("สรุปวันนี้")).toBe("my_done_today");
  });

  it.each(negativePhraseCases)("does not hijack %s", (phrase) => {
    expect(matchQuestionIntent(phrase)).toBeNull();
  });
});

interface IntentAnswerCase {
  intent: string;
  actor: string;
  question: string;
  expectedParts: string[];
  absentParts?: string[];
}

// Every expected number below is hand-counted from seedScenario, not queried in the test.
const intentAnswerCases: IntentAnswerCase[] = [
  {
    intent: "my_tasks",
    actor: "P-W1",
    question: "งานของฉันมีอะไรบ้าง",
    expectedParts: ["งานของพี่ 2 งาน", "T-W-OVER", "T-W-OPEN"],
  },
  {
    intent: "my_open",
    actor: "P-W1",
    question: "งานที่ค้างอยู่ตอนนี้",
    expectedParts: ["งานของพี่ที่ค้างอยู่ 2 งาน", "T-W-OVER", "T-W-OPEN"],
  },
  {
    intent: "my_overdue",
    actor: "P-W1",
    question: "งานที่เกินกำหนดแล้ว",
    expectedParts: ["งานของพี่ที่เกินกำหนด 1 งาน", "T-W-OVER"],
    absentParts: ["T-A2-OVER"],
  },
  {
    intent: "my_done_today",
    actor: "P-W1",
    question: "งานที่เสร็จวันนี้",
    expectedParts: ["งานที่พี่ทำเสร็จวันนี้ 1 งาน", "T-W-DONE-TODAY"],
    absentParts: ["T-W-DONE-WEEK"],
  },
  {
    intent: "my_done_week",
    actor: "P-W1",
    question: "งานที่เสร็จสัปดาห์นี้",
    expectedParts: [
      "งานที่พี่ทำเสร็จสัปดาห์นี้ 2 งาน",
      "T-W-DONE-TODAY",
      "T-W-DONE-WEEK",
    ],
  },
  {
    intent: "my_next",
    actor: "P-W1",
    question: "งานถัดไปที่ต้องทำ",
    expectedParts: ["งานของพี่ถัดไป", "T-W-OVER"],
    absentParts: ["T-W-OPEN"],
  },
  {
    intent: "my_latest_assigned",
    actor: "P-W1",
    question: "งานล่าสุดที่ได้รับมอบหมาย",
    expectedParts: ["มอบหมายให้พี่ล่าสุด", "T-W-OPEN", "27 ส.ค. 2569 15:30 น."],
    absentParts: ["2026-08-27T08:30:00.000Z"],
  },
  {
    intent: "team_unaccepted",
    actor: "P-MANAGER-A",
    question: "ใครยังไม่รับงาน",
    expectedParts: ["2 งาน", "P-W1", "P-A2", "30 นาที"],
    absentParts: ["P-B1"],
  },
  {
    intent: "team_most_open",
    actor: "P-MANAGER-A",
    question: "ใครมีงานค้างมากที่สุด",
    expectedParts: ["P-A2", "3 งาน"],
    absentParts: ["P-B1"],
  },
  {
    intent: "team_overdue",
    actor: "P-MANAGER-A",
    question: "งานที่เกินกำหนดของทีม",
    expectedParts: ["2 งาน", "T-W-OVER", "T-A2-OVER"],
    absentParts: ["T-B-OVER", "P-B1"],
  },
  {
    intent: "team_today",
    actor: "P-MANAGER-A",
    question: "สรุปงานวันนี้ทั้งทีม",
    expectedParts: [
      "งานใหม่วันนี้ 7 งาน",
      "งานเสร็จวันนี้ 2 งาน",
      "มีผู้รับแล้วและยังเปิดอยู่ตอนนี้ 5 งาน",
      "ยังไม่มีผู้รับและยังเปิดอยู่ตอนนี้ 1 งาน",
    ],
  },
  {
    intent: "team_rejected",
    actor: "P-MANAGER-A",
    question: "ใครปฏิเสธงานบ้าง",
    expectedParts: ["2 งาน", "T-W-REJECT", "T-A2-REJECT"],
    absentParts: ["T-B-REJECT", "P-B1"],
  },
  {
    intent: "team_unassigned",
    actor: "P-MANAGER-A",
    question: "งานที่ยังไม่มีคนรับ",
    expectedParts: ["2 งาน", "T-UNASSIGNED", "T-UNASSIGNED-OPEN"],
  },
  {
    intent: "stats_completed_month",
    actor: "P-OWNER",
    question: "งานเสร็จกี่ใบเดือนนี้",
    expectedParts: ["5 งาน"],
  },
  {
    intent: "stats_rejected_month",
    actor: "P-OWNER",
    question: "งานถูกปฏิเสธกี่ใบเดือนนี้",
    expectedParts: ["3 งาน"],
  },
  {
    intent: "stats_avg_cycle",
    actor: "P-OWNER",
    question: "เวลาเฉลี่ยตั้งแต่รับงานถึงเสร็จงาน",
    expectedParts: ["5 งาน", "1.3 ชั่วโมง"],
  },
  {
    intent: "stats_fastest_accept",
    actor: "P-OWNER",
    question: "ใครรับงานเร็วที่สุด",
    expectedParts: ["P-A2", "13 นาที", "3 งาน"],
  },
  {
    intent: "stats_new_today",
    actor: "P-OWNER",
    question: "วันนี้มีงานใหม่กี่ใบ",
    expectedParts: ["10 งาน", "ในจำนวนนี้ยังไม่มีผู้รับ 2 งาน"],
  },
  {
    intent: "help",
    actor: "P-W1",
    question: "AI ช่วยอะไรได้บ้าง",
    expectedParts: [
      "1. พิมพ์ว่า \"งานของฉันมีอะไรบ้าง\" ได้",
      "20. พิมพ์ว่า \"สถานะระบบ\" ได้",
    ],
  },
  {
    intent: "system_status",
    actor: "P-OWNER",
    question: "สถานะระบบ",
    expectedParts: [
      "27 ส.ค. 2569 15:55 น.",
      "คิวที่รอประมวลผลมี 1 งาน",
      "27 ส.ค. 2569 15:50 น.",
      "ผล ok",
    ],
    absentParts: ["2026-08-27T08:55:00.000Z", "2026-08-27T08:50:00.000Z"],
  },
];

describe("answers from real SQLite queries", () => {
  it.each(intentAnswerCases)(
    "answers $intent from the hand-counted seed",
    async ({ intent, actor, question, expectedParts, absentParts = [] }) => {
      const answer = await askQuestion(database.asD1(), actor, question, now);

      expect(answer).toMatchObject({ intent, matched: true, denied: false });
      for (const part of expectedParts) expect(answer.text).toContain(part);
      for (const part of absentParts) expect(answer.text).not.toContain(part);
      expect(answer.text.endsWith("ค่ะ") || answer.text.endsWith("คะ")).toBe(true);
      expect(answer.text.match(/ค่ะ|คะ/g) ?? []).toHaveLength(1);
      if (intent === "help") expect(answer.text.split("\n")).toHaveLength(21);
    },
  );

  it("keeps list bullets plain and uses one closing particle", async () => {
    const answer = await askQuestion(
      database.asD1(),
      "P-W1",
      "งานของฉันมีอะไรบ้าง",
      now,
    );
    const bullets = answer.text.split("\n").filter((line) => line.startsWith("• "));

    expect(bullets).toHaveLength(2);
    for (const bullet of bullets) expect(bullet).not.toMatch(/ค่ะ|คะ/);
    expect(answer.text.match(/ค่ะ|คะ/g) ?? []).toHaveLength(1);
  });

  it("reports a top-three ranking and discloses omitted tied workers", async () => {
    const tieDatabase = new SQLiteD1();
    try {
      await insertPerson(tieDatabase, "P-TIE-M", "operations", "manager");
      const counts = new Map([
        ["P-TIE-A", 5],
        ["P-TIE-B", 3],
        ["P-TIE-C", 3],
        ["P-TIE-D", 3],
        ["P-TIE-E", 3],
      ]);
      for (const [assignee, count] of counts) {
        await insertPerson(tieDatabase, assignee, "operations", "worker");
        for (let index = 1; index <= count; index += 1) {
          await insertTask(tieDatabase, {
            ref: `T-${assignee}-${index}`,
            title: `งานอันดับ ${index}`,
            status: "assigned",
            assignee,
            createdAt: `2026-08-${String(20 + index).padStart(2, "0")}T00:00:00.000Z`,
          });
        }
      }

      const answer = await askQuestion(
        tieDatabase.asD1(),
        "P-TIE-M",
        "ใครงานค้างเยอะ",
        now,
      );

      expect(answer.text).toContain("1. P-TIE-A: 5 งาน");
      expect(answer.text).toContain("2. P-TIE-B: 3 งาน");
      expect(answer.text).toContain("3. P-TIE-C: 3 งาน");
      expect(answer.text).toContain("แสดง 3 จาก 5 คน");
      expect(answer.text).not.toContain("P-TIE-D");
      expect(answer.text).not.toContain("P-TIE-E");
    } finally {
      tieDatabase.close();
    }
  });

  it("labels a month-old unassigned open task separately from today's figures", async () => {
    const scoped = new SQLiteD1();
    try {
      await insertPerson(scoped, "P-SCOPE-OWNER", "management", "owner");
      await insertTask(scoped, {
        ref: "T-UNASSIGNED-MONTH-OLD",
        title: "งานค้างจากเดือนก่อน",
        status: "assigned",
        assignee: null,
        createdAt: "2026-07-01T00:00:00.000Z",
      });

      const answer = await askQuestion(
        scoped.asD1(),
        "P-SCOPE-OWNER",
        "สรุปงานวันนี้ทั้งทีม",
        now,
      );

      expect(answer.text).toContain("งานใหม่วันนี้ 0 งาน");
      expect(answer.text).toContain("งานเสร็จวันนี้ 0 งาน");
      expect(answer.text).toContain("มีผู้รับแล้วและยังเปิดอยู่ตอนนี้ 0 งาน");
      expect(answer.text).toContain("ยังไม่มีผู้รับและยังเปิดอยู่ตอนนี้ 1 งาน");
      expect(answer.text).not.toContain("ในจำนวนนี้");
    } finally {
      scoped.close();
    }
  });

  it("counts today's team work in SQL even when 600 older rows sort first", async () => {
    const crowded = new SQLiteD1();
    try {
      await insertPerson(crowded, "P-TODAY-M", "operations", "manager");
      await insertPerson(crowded, "P-TODAY-W", "operations", "worker");
      for (let index = 1; index <= 600; index += 1) {
        await insertTask(crowded, {
          ref: `T-TODAY-OLD-${String(index).padStart(4, "0")}`,
          title: "งานค้างเก่า",
          status: "assigned",
          assignee: "P-TODAY-W",
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }
      for (let index = 1; index <= 3; index += 1) {
        await insertTask(crowded, {
          ref: `T-TODAY-NEW-${index}`,
          title: "งานใหม่วันนี้",
          status: "assigned",
          assignee: "P-TODAY-W",
          createdAt: `2026-08-27T0${index}:00:00.000Z`,
        });
      }
      for (let index = 1; index <= 2; index += 1) {
        await insertTask(crowded, {
          ref: `T-TODAY-DONE-${index}`,
          title: "งานเสร็จวันนี้",
          status: "completed",
          assignee: "P-TODAY-W",
          createdAt: "2026-01-02T00:00:00.000Z",
          acceptedAt: "2026-08-27T04:00:00.000Z",
          completedAt: `2026-08-27T0${4 + index}:00:00.000Z`,
        });
      }

      const answer = await askQuestion(
        crowded.asD1(),
        "P-TODAY-M",
        "สรุปงานวันนี้ทั้งทีม",
        now,
      );

      expect(answer.text).toContain("งานใหม่วันนี้ 3 งาน");
      expect(answer.text).toContain("งานเสร็จวันนี้ 2 งาน");
      expect(answer.text).toContain(
        "มีผู้รับแล้วและยังเปิดอยู่ตอนนี้ 603 งาน",
      );
    } finally {
      crowded.close();
    }
  });

  it("omits the wait duration when an assigned timestamp cannot be parsed", async () => {
    const invalidTime = new SQLiteD1();
    try {
      await insertPerson(invalidTime, "P-TIME-M", "operations", "manager");
      await insertPerson(invalidTime, "P-TIME-W", "operations", "worker");
      await insertTask(invalidTime, {
        ref: "T-INVALID-ASSIGNED-TIME",
        title: "งานเวลาเสีย",
        status: "assigned",
        assignee: "P-TIME-W",
        createdAt: "not-a-timestamp",
      });

      const answer = await askQuestion(
        invalidTime.asD1(),
        "P-TIME-M",
        "ใครยังไม่รับงาน",
        now,
      );

      expect(answer.text).toContain("P-TIME-W: T-INVALID-ASSIGNED-TIME");
      expect(answer.text).not.toContain("รอรับมา");
      expect(answer.text).not.toContain("NaN");
    } finally {
      invalidTime.close();
    }
  });

  it("ranks SQL aggregates without dropping a person after 500 task rows", async () => {
    const crowded = new SQLiteD1();
    try {
      await insertPerson(crowded, "P-LIMIT-OWNER", "management", "owner");
      await insertPerson(crowded, "P-AAA", "operations", "worker");
      await insertPerson(crowded, "P-ZZZ", "operations", "worker");
      for (let index = 1; index <= 501; index += 1) {
        await insertTask(crowded, {
          ref: `T-AAA-${String(index).padStart(4, "0")}`,
          title: `งาน A ลำดับ ${index}`,
          status: "assigned",
          assignee: "P-AAA",
          createdAt: `2026-08-20T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
        });
      }
      for (let index = 1; index <= 600; index += 1) {
        await insertTask(crowded, {
          ref: `T-ZZZ-${String(index).padStart(4, "0")}`,
          title: `งาน Z ลำดับ ${index}`,
          status: "assigned",
          assignee: "P-ZZZ",
          createdAt: `2026-08-21T00:${String(index % 60).padStart(2, "0")}:00.000Z`,
        });
      }

      const answer = await askQuestion(
        crowded.asD1(),
        "P-LIMIT-OWNER",
        "ใครมีงานค้างมากที่สุด",
        now,
      );

      expect(answer.text).toContain("P-ZZZ มีงานค้างมากที่สุด 600 งาน");
      expect(answer.text).not.toContain("500 งานแรก");
    } finally {
      crowded.close();
    }
  });

  it("finds the fastest SQL aggregate even when another person has over 500 rows", async () => {
    const crowded = new SQLiteD1();
    try {
      await insertPerson(crowded, "P-FAST-OWNER", "management", "owner");
      await insertPerson(crowded, "P-AAA", "operations", "worker");
      await insertPerson(crowded, "P-ZZZ", "operations", "worker");
      for (let index = 1; index <= 501; index += 1) {
        await insertTask(crowded, {
          ref: `T-FAST-A-${String(index).padStart(4, "0")}`,
          title: `งานรับช้า ${index}`,
          status: "accepted",
          assignee: "P-AAA",
          createdAt: "2026-08-20T00:00:00.000Z",
          acceptedAt: "2026-08-20T00:10:00.000Z",
        });
      }
      for (let index = 1; index <= 600; index += 1) {
        await insertTask(crowded, {
          ref: `T-FAST-Z-${String(index).padStart(4, "0")}`,
          title: `งานรับเร็ว ${index}`,
          status: "accepted",
          assignee: "P-ZZZ",
          createdAt: "2026-08-20T00:00:00.000Z",
          acceptedAt: "2026-08-20T00:01:00.000Z",
        });
      }

      const answer = await askQuestion(
        crowded.asD1(),
        "P-FAST-OWNER",
        "ใครรับงานเร็วที่สุด",
        now,
      );

      expect(answer.text).toContain("P-ZZZ รับงานเร็วที่สุด");
      expect(answer.text).toContain("600 งาน");
      expect(answer.text).not.toContain("500 งานแรก");
    } finally {
      crowded.close();
    }
  });

  it("bounds fastest-accept to this month and reports skipped bad timestamps", async () => {
    const invalidTime = new SQLiteD1();
    try {
      await insertPerson(invalidTime, "P-TIME-OWNER", "management", "owner");
      await insertPerson(invalidTime, "P-TIME-W", "operations", "worker");
      await insertTask(invalidTime, {
        ref: "T-TIME-OLD-BAD",
        title: "ข้อมูลเก่านอกหน้าต่าง",
        status: "accepted",
        assignee: "P-TIME-W",
        createdAt: "2019-01-01T00:00:00.000Z",
        acceptedAt: "2019-01-01T25:00:00.000Z",
      });
      await insertTask(invalidTime, {
        ref: "T-TIME-CURRENT-BAD",
        title: "ข้อมูลเสียในเดือนนี้",
        status: "accepted",
        assignee: "P-TIME-W",
        createdAt: "2026-08-10T00:00:00.000Z",
        acceptedAt: "2026-08-10T25:00:00.000Z",
      });
      await insertTask(invalidTime, {
        ref: "T-TIME-CURRENT-GOOD",
        title: "ข้อมูลดีในเดือนนี้",
        status: "accepted",
        assignee: "P-TIME-W",
        createdAt: "2026-08-20T00:00:00.000Z",
        acceptedAt: "2026-08-20T00:05:00.000Z",
      });

      const answer = await askQuestion(
        invalidTime.asD1(),
        "P-TIME-OWNER",
        "ใครรับงานเร็วที่สุด",
        now,
      );

      expect(answer.text).toContain("P-TIME-W รับงานเร็วที่สุด");
      expect(answer.text).toContain("5 นาที");
      expect(answer.text).toContain("ข้ามข้อมูลเวลาที่อ่านไม่ได้ 1 งาน");
      expect(answer.text).not.toContain("2 งาน");
    } finally {
      invalidTime.close();
    }
  });

  const timestampAggregateIntents = registeredIntents.filter(
    (registered) => registered.timestampAggregate !== null,
  );

  it.each(timestampAggregateIntents)(
    "skips one bad timestamp without vetoing aggregate $id",
    async ({ id, question, timestampAggregate }) => {
      const aggregateDb = new SQLiteD1();
      try {
        await insertPerson(aggregateDb, "P-AGG-OWNER", "management", "owner");
        await insertPerson(aggregateDb, "P-AGG-W", "operations", "worker");
        for (let index = 1; index <= 21; index += 1) {
          const bad = index === 21;
          await insertTask(aggregateDb, {
            ref: `T-AGG-${timestampAggregate}-${String(index).padStart(2, "0")}`,
            title: `งาน aggregate ${index}`,
            status: timestampAggregate === "cycle" ? "completed" : "accepted",
            assignee: "P-AGG-W",
            createdAt: "2026-08-20T00:00:00.000Z",
            acceptedAt:
              timestampAggregate === "accept" && bad
                ? "2026-08-20T25:00:00.000Z"
                : timestampAggregate === "accept"
                  ? "2026-08-20T00:05:00.000Z"
                  : "2026-08-20T00:10:00.000Z",
            completedAt:
              timestampAggregate === "cycle"
                ? bad
                  ? "2026-08-20T25:00:00.000Z"
                  : "2026-08-20T00:40:00.000Z"
                : undefined,
          });
        }

        const answer = await askQuestion(
          aggregateDb.asD1(),
          "P-AGG-OWNER",
          question,
          now,
        );

        expect(answer).toMatchObject({ intent: id, matched: true, denied: false });
        expect(answer.text).toContain("20 งาน");
        expect(answer.text).toContain(
          timestampAggregate === "cycle" ? "30 นาที" : "5 นาที",
        );
        expect(answer.text).toContain("ข้ามข้อมูลเวลาที่อ่านไม่ได้ 1 งาน");
      } finally {
        aggregateDb.close();
      }
    },
  );

  it("keeps all four non-team statistics complete after 501 invisible rows", async () => {
    const crowded = new SQLiteD1();
    try {
      await insertPerson(crowded, "P-STATS-W", "operations", "worker");
      await insertPerson(crowded, "P-STATS-OTHER", "finance", "worker");
      for (let index = 1; index <= 501; index += 1) {
        const ref = `T-A-OTHER-${String(index).padStart(4, "0")}`;
        await insertTask(crowded, {
          ref,
          title: `งานคนอื่น ${index}`,
          status: "completed",
          assignee: "P-STATS-OTHER",
          createdAt: "2026-08-01T00:00:00.000Z",
          acceptedAt: "2026-08-01T00:01:00.000Z",
          completedAt: "2026-08-01T00:02:00.000Z",
        });
        await insertEvent(crowded, ref, "rejected", "2026-08-01T00:01:30.000Z");
      }
      await insertTask(crowded, {
        ref: "T-Z-WORKER-OWN",
        title: "งานของเจ้าตัว",
        status: "completed",
        assignee: "P-STATS-W",
        createdAt: "2026-08-27T08:00:00.000Z",
        acceptedAt: "2026-08-27T08:10:00.000Z",
        completedAt: "2026-08-27T08:40:00.000Z",
      });
      await insertEvent(
        crowded,
        "T-Z-WORKER-OWN",
        "rejected",
        "2026-08-27T08:20:00.000Z",
      );

      const questions = [
        "งานเสร็จกี่ใบเดือนนี้",
        "งานถูกปฏิเสธกี่ใบเดือนนี้",
        "เวลาเฉลี่ยตั้งแต่รับงานถึงเสร็จงาน",
        "วันนี้มีงานใหม่กี่ใบ",
      ];
      for (const question of questions) {
        const answer = await askQuestion(
          crowded.asD1(),
          "P-STATS-W",
          question,
          now,
        );
        expect(answer.text).toContain("1 งาน");
        expect(answer.text).not.toContain("ไม่มีงาน");
        expect(answer.text).not.toContain("500 งานแรก");
      }
      const average = await askQuestion(
        crowded.asD1(),
        "P-STATS-W",
        "เวลาเฉลี่ยตั้งแต่รับงานถึงเสร็จงาน",
        now,
      );
      expect(average.text).toContain("30 นาที");
    } finally {
      crowded.close();
    }
  });

  it("chunks visible people before a task query reaches 100 bound parameters", async () => {
    const crowded = new SQLiteD1();
    try {
      await insertPerson(crowded, "P-CHUNK-OWNER", "management", "owner");
      for (let index = 1; index <= 120; index += 1) {
        const suffix = String(index).padStart(3, "0");
        const personCode = `P-CHUNK-${suffix}`;
        await insertPerson(crowded, personCode, "operations", "worker");
        await insertTask(crowded, {
          ref: `T-CHUNK-${suffix}`,
          title: "งานทดสอบเพดานพารามิเตอร์",
          status: "assigned",
          assignee: personCode,
          createdAt: "2026-08-27T08:00:00.000Z",
        });
      }

      const base = crowded.asD1();
      let taskQueries = 0;
      let maximumTaskBindings = 0;
      const ceilingDb = {
        prepare(query: string): D1PreparedStatement {
          if (/\bFROM\s+task\b/i.test(query)) {
            taskQueries += 1;
            const bindings = (query.match(/\?/g) ?? []).length;
            maximumTaskBindings = Math.max(maximumTaskBindings, bindings);
            if (bindings > 100) throw new Error("D1 bound-parameter ceiling");
          }
          return base.prepare(query);
        },
      } as unknown as D1Database;

      const answer = await askQuestion(
        ceilingDb,
        "P-CHUNK-OWNER",
        "ใครมีงานค้างมากที่สุด",
        now,
      );

      expect(answer).toMatchObject({
        intent: "team_most_open",
        matched: true,
        denied: false,
      });
      expect(answer.text).not.toContain("อ่านข้อมูลไม่ได้");
      expect(taskQueries).toBe(2);
      expect(maximumTaskBindings).toBeLessThanOrEqual(100);
    } finally {
      crowded.close();
    }
  });

  it("class guard: every registered intent scopes visibility before truncation", async () => {
    const crowded = new SQLiteD1();
    try {
      await insertPerson(crowded, "P-Z-ACTOR", "operations", "manager");

      // These rows are visible but irrelevant to today's new/completed counts.
      // They sort before the actor's rows and reproduce the old team_today bug,
      // where TypeScript filtered a list after SQL had already cut it at 500.
      for (let index = 1; index <= 600; index += 1) {
        await insertTask(crowded, {
          ref: `T-A-VISIBLE-OLD-UNASSIGNED-${String(index).padStart(4, "0")}`,
          title: "งานว่างเก่าที่เรียงก่อน",
          status: "assigned",
          assignee: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        });
      }

      // More distinct people than the historical LIMIT 501 is essential here.
      // Hundreds of rows owned by one person cannot expose a per-person aggregate cutoff.
      for (let index = 1; index <= 502; index += 1) {
        const suffix = String(index).padStart(4, "0");
        const hiddenPersonCode = `P-A-HIDDEN-${suffix}`;
        const assignedRef = `T-A-HIDDEN-ASSIGNED-${suffix}`;
        const completedRef = `T-A-HIDDEN-COMPLETED-${suffix}`;
        const rejectedRef = `T-A-HIDDEN-REJECTED-${suffix}`;
        await insertPerson(crowded, hiddenPersonCode, "finance", "worker");
        await insertTask(crowded, {
          ref: assignedRef,
          title: "งานซ่อนที่เรียงก่อน",
          status: "assigned",
          assignee: hiddenPersonCode,
          createdAt: "2026-08-27T00:00:00.000Z",
          dueAt: "2026-08-27T00:01:00.000Z",
        });
        await insertTask(crowded, {
          ref: completedRef,
          title: "งานเสร็จที่ซ่อน",
          status: "completed",
          assignee: hiddenPersonCode,
          createdAt: "2026-08-27T00:00:00.000Z",
          acceptedAt: "2026-08-27T00:00:10.000Z",
          completedAt: "2026-08-27T00:20:00.000Z",
        });
        await insertTask(crowded, {
          ref: rejectedRef,
          title: "งานปฏิเสธที่ซ่อน",
          status: "rejected",
          assignee: hiddenPersonCode,
          createdAt: "2026-08-27T00:00:00.000Z",
        });
        await insertEvent(
          crowded,
          rejectedRef,
          "rejected",
          "2026-08-27T00:30:00.000Z",
        );
        // Every hidden person owns more open work than the actor. Removing the
        // scope from a rank aggregate must therefore change the winner.
        for (let taskIndex = 2; taskIndex <= 8; taskIndex += 1) {
          await insertTask(crowded, {
            ref: `T-A-HIDDEN-ASSIGNED-${suffix}-${taskIndex}`,
            title: "งานซ่อนเพิ่มเพื่อชนะอันดับ",
            status: "assigned",
            assignee: hiddenPersonCode,
            createdAt: "2026-08-27T00:00:00.000Z",
            dueAt: "2026-08-27T00:01:00.000Z",
          });
        }
      }

      for (const suffix of ["A", "B", "C", "D", "E", "F", "G"]) {
        const assignedRef = `T-Z-VISIBLE-ASSIGNED-${suffix}`;
        const completedRef = `T-Z-VISIBLE-COMPLETED-${suffix}`;
        const rejectedRef = `T-Z-VISIBLE-REJECTED-${suffix}`;
        await insertTask(crowded, {
          ref: assignedRef,
          title: "งานของผู้ถามที่เรียงท้าย",
          status: "assigned",
          assignee: "P-Z-ACTOR",
          createdAt: "2026-08-27T08:58:00.000Z",
          dueAt: "2026-08-27T08:59:00.000Z",
        });
        await insertEvent(
          crowded,
          assignedRef,
          "assigned",
          "2026-08-27T08:58:00.000Z",
        );
        await insertTask(crowded, {
          ref: completedRef,
          title: "งานเสร็จของผู้ถามที่เรียงท้าย",
          status: "completed",
          assignee: "P-Z-ACTOR",
          createdAt: "2026-08-27T08:58:00.000Z",
          acceptedAt: "2026-08-27T08:59:00.000Z",
          completedAt: "2026-08-27T09:00:00.000Z",
        });
        await insertTask(crowded, {
          ref: rejectedRef,
          title: "งานปฏิเสธของผู้ถามที่เรียงท้าย",
          status: "rejected",
          assignee: "P-Z-ACTOR",
          createdAt: "2026-08-27T08:58:00.000Z",
        });
        await insertEvent(
          crowded,
          rejectedRef,
          "rejected",
          "2026-08-27T08:59:00.000Z",
        );
        await insertTask(crowded, {
          ref: `T-Z-VISIBLE-UNASSIGNED-${suffix}`,
          title: "งานว่างที่เรียงท้าย",
          status: "assigned",
          assignee: null,
          createdAt: "2026-08-27T08:58:00.000Z",
        });
      }

      const expectedCountFragments = new Map<string, string[]>([
        ["my_tasks", ["งานของพี่ 7 งาน"]],
        ["my_open", ["ค้างอยู่ 7 งาน"]],
        ["my_overdue", ["เกินกำหนด 7 งาน"]],
        ["my_done_today", ["เสร็จวันนี้ 7 งาน"]],
        ["my_done_week", ["เสร็จสัปดาห์นี้ 7 งาน"]],
        ["team_unaccepted", ["งานที่ยังไม่รับ 7 งาน"]],
        ["team_most_open", ["P-Z-ACTOR: 7 งาน"]],
        ["team_overdue", ["ทีมที่พี่ดูได้ 7 งาน"]],
        [
          "team_today",
          [
            "งานใหม่วันนี้ 28 งาน",
            "งานเสร็จวันนี้ 7 งาน",
            "มีผู้รับแล้วและยังเปิดอยู่ตอนนี้ 7 งาน",
            "ยังไม่มีผู้รับและยังเปิดอยู่ตอนนี้ 607 งาน",
          ],
        ],
        ["team_rejected", ["ขอบเขตทีม 7 งาน"]],
        ["team_unassigned", ["ยังไม่มีผู้รับ 607 งาน"]],
        ["stats_completed_month", ["งานเสร็จ 7 งาน"]],
        ["stats_rejected_month", ["งานถูกปฏิเสธ 7 งาน"]],
        ["stats_avg_cycle", ["คำนวณจาก 7 งาน"]],
        ["stats_fastest_accept", ["P-Z-ACTOR", "จาก 7 งาน"]],
        ["stats_new_today", ["งานใหม่ 28 งาน", "ยังไม่มีผู้รับ 7 งาน"]],
      ]);
      const taskIntentsWithoutReportedCounts = new Set([
        "my_next",
        "my_latest_assigned",
      ]);

      const base = crowded.asD1();
      for (const registered of registeredIntents) {
        const sqlStatements: string[] = [];
        const observingDb = {
          prepare(query: string): D1PreparedStatement {
            sqlStatements.push(query);
            return base.prepare(query);
          },
          batch(statements: D1PreparedStatement[]) {
            return base.batch(statements);
          },
        } as unknown as D1Database;

        const answer = await askQuestion(
          observingDb,
          "P-Z-ACTOR",
          registered.question,
          now,
        );
        expect(answer, registered.id).toMatchObject({
          intent: registered.id,
          matched: true,
          denied: false,
        });
        expect(answer.text, registered.id).not.toContain("P-A-HIDDEN-");
        expect(answer.text, registered.id).not.toContain("T-A-HIDDEN-");

        const taskSql = sqlStatements.filter((sql) => /\bFROM\s+task\b/i.test(sql));
        for (const sql of taskSql.filter((statement) => /\bLIMIT\b/i.test(statement))) {
          const beforeLimit = sql.slice(0, sql.search(/\bLIMIT\b/i));
          const scopedBeforeLimit =
            /assignee_person_code\s*=\s*\?/i.test(beforeLimit) ||
            /assignee_person_code\s+IN\s*\(/i.test(beforeLimit) ||
            /assignee_person_code\s+IS\s+NULL/i.test(beforeLimit);
          expect(scopedBeforeLimit, `${registered.id}: ${sql}`).toBe(true);
        }

        if (taskSql.length > 0) {
          expect(answer.text, registered.id).not.toMatch(
            /(?:ตรวจแล้ว ไม่มีงาน|เพราะไม่มีงาน|ยังไม่มีงาน|ไม่พบงาน)/,
          );
          const namesVisibleRow =
            answer.text.includes("T-Z-VISIBLE") ||
            answer.text.includes("P-Z-ACTOR");
          const expectedCounts = expectedCountFragments.get(registered.id);
          if (taskIntentsWithoutReportedCounts.has(registered.id)) {
            expect(namesVisibleRow, registered.id).toBe(true);
          } else {
            if (!expectedCounts) {
              throw new Error(`Missing hand-counted fixture for ${registered.id}`);
            }
            for (const expectedCount of expectedCounts) {
              expect(answer.text, registered.id).toContain(expectedCount);
            }
            expect(
              taskSql.some((sql) => /\b(?:COUNT|SUM)\s*\(/i.test(sql)),
              `${registered.id} must compute reported counts in SQL`,
            ).toBe(true);
          }
        }

      }
    } finally {
      crowded.close();
    }
  }, 30_000);

  it("shows all short task rows when the complete message fits", async () => {
    const crowded = new SQLiteD1();
    try {
      await insertPerson(crowded, "P-LIST-W", "operations", "worker");
      for (let index = 1; index <= 12; index += 1) {
        await insertTask(crowded, {
          ref: `T-LIST-${String(index).padStart(2, "0")}`,
          title: `งานรายการ ${index}`,
          status: "assigned",
          assignee: "P-LIST-W",
          createdAt: "2026-08-20T00:00:00.000Z",
        });
      }

      const answer = await askQuestion(
        crowded.asD1(),
        "P-LIST-W",
        "งานของฉันมีอะไรบ้าง",
        now,
      );
      const bullets = answer.text.split("\n").filter((line) => line.startsWith("• "));

      expect(bullets).toHaveLength(12);
      expect(answer.text).not.toContain("แสดง ");
      expect(answer.text).toContain("งานของพี่ 12 งาน");
      expect(answer.text.length).toBeLessThan(5_000);
    } finally {
      crowded.close();
    }
  });

  it("class guard: caps long-title answers by characters, not row count", async () => {
    const crowded = new SQLiteD1();
    try {
      await insertPerson(crowded, "P-LONG-W", "operations", "worker");
      for (let index = 1; index <= 12; index += 1) {
        await insertTask(crowded, {
          ref: `T-LONG-${String(index).padStart(2, "0")}`,
          title: "ก".repeat(1_000),
          status: "assigned",
          assignee: "P-LONG-W",
          createdAt: "2026-08-20T00:00:00.000Z",
        });
      }

      const answer = await askQuestion(
        crowded.asD1(),
        "P-LONG-W",
        "งานของฉันมีอะไรบ้าง",
        now,
      );
      const shown = answer.text
        .split("\n")
        .filter((line) => line.startsWith("• ")).length;

      expect(answer.text.length).toBeLessThan(5_000);
      expect(shown).toBeGreaterThan(0);
      expect(answer.text).toContain(`แสดง ${shown} จาก 12 งาน`);
    } finally {
      crowded.close();
    }
  });

  it("shows all short custom unaccepted-team rows when they fit", async () => {
    const crowded = new SQLiteD1();
    try {
      await insertPerson(crowded, "P-LIST-M", "operations", "manager");
      await insertPerson(crowded, "P-LIST-A", "operations", "worker");
      for (let index = 1; index <= 12; index += 1) {
        await insertTask(crowded, {
          ref: `T-UNACCEPTED-${String(index).padStart(2, "0")}`,
          title: `งานรอรับ ${index}`,
          status: "assigned",
          assignee: "P-LIST-A",
          createdAt: "2026-08-20T00:00:00.000Z",
        });
      }

      const answer = await askQuestion(
        crowded.asD1(),
        "P-LIST-M",
        "ใครยังไม่รับงาน",
        now,
      );
      const bullets = answer.text.split("\n").filter((line) => line.startsWith("• "));

      expect(bullets).toHaveLength(12);
      expect(answer.text).not.toContain("แสดง ");
      expect(answer.text).toContain("งานที่ยังไม่รับ 12 งาน");
      expect(answer.text.length).toBeLessThan(5_000);
    } finally {
      crowded.close();
    }
  });

  it("bounds row-level team reads after visibility and discloses the cutoff", async () => {
    const crowded = new SQLiteD1();
    try {
      await insertPerson(crowded, "P-BOUND-M", "operations", "manager");
      await insertPerson(crowded, "P-BOUND-W", "operations", "worker");
      for (let index = 1; index <= 501; index += 1) {
        await insertTask(crowded, {
          ref: `T-BOUND-${String(index).padStart(4, "0")}`,
          title: `งานรอรับ ${index}`,
          status: "assigned",
          assignee: "P-BOUND-W",
          createdAt: "2026-08-20T00:00:00.000Z",
        });
      }

      const answer = await askQuestion(
        crowded.asD1(),
        "P-BOUND-M",
        "ใครยังไม่รับงาน",
        now,
      );

      expect(answer.text).toContain("งานที่ยังไม่รับ 501 งาน");
      expect(answer.text).toContain("แสดงรายละเอียด 500 งานแรกตามลำดับคิวเท่านั้น");
      expect(answer.text).toContain("จำนวนรวมคำนวณจากงานทั้งหมดที่ตรงเงื่อนไขค่ะ");
      expect(answer.text.length).toBeLessThan(5_000);
    } finally {
      crowded.close();
    }
  });

  it("caps one extreme title and discloses that the title was shortened", async () => {
    const crowded = new SQLiteD1();
    try {
      await insertPerson(crowded, "P-EXTREME-W", "operations", "worker");
      await insertTask(crowded, {
        ref: "T-EXTREME",
        title: "ข".repeat(10_000),
        status: "assigned",
        assignee: "P-EXTREME-W",
        createdAt: "2026-08-20T00:00:00.000Z",
      });

      const answer = await askQuestion(
        crowded.asD1(),
        "P-EXTREME-W",
        "งานของฉันมีอะไรบ้าง",
        now,
      );

      expect(answer.text.length).toBeLessThan(5_000);
      expect(answer.text).toContain("ชื่องานที่ยาวถูกย่อด้วย …");
      expect(answer.text).toContain("T-EXTREME");
    } finally {
      crowded.close();
    }
  });

  it("never cuts a non-BMP character into a lone surrogate", async () => {
    const unicodeDb = new SQLiteD1();
    try {
      await insertPerson(unicodeDb, "P-UNICODE-W", "operations", "worker");
      await insertTask(unicodeDb, {
        ref: "T-UNICODE",
        title: `${"ก".repeat(798)}😀ท้ายข้อความ`,
        status: "assigned",
        assignee: "P-UNICODE-W",
        createdAt: "2026-08-20T00:00:00.000Z",
      });

      const answer = await askQuestion(
        unicodeDb.asD1(),
        "P-UNICODE-W",
        "งานของฉันมีอะไรบ้าง",
        now,
      );

      expect(answer.text).toContain("ชื่องานที่ยาวถูกย่อด้วย …");
      expect(answer.text).not.toContain("😀");
      expect(hasUnpairedSurrogate(answer.text)).toBe(false);
    } finally {
      unicodeDb.close();
    }
  });
});

describe("visibility and fail-closed behavior", () => {
  const deniedQuestions = registeredIntents
    .filter((registered) => registered.teamOnly)
    .map((registered) => [registered.id, registered.question] as const);

  it("keeps role-based visibility decisions out of the query engine", () => {
    const source = readFileSync(
      new URL("../src/queryEngine.ts", import.meta.url),
      "utf8",
    );

    // Stop direct property, bracket, and destructuring access from moving role
    // decisions out of visibility.ts and back into the query engine.
    const forbiddenRoleLogic =
      /(?:\.\s*role\b|\[\s*["']role["']\s*\]|\{[^}]*\brole\b[^}]*\}\s*=)/;
    for (const bypass of [
      "actor.role",
      'actor["role"]',
      "const { role } = actor",
      "const {\n  role: actorRole\n} = actor",
    ]) {
      expect(bypass).toMatch(forbiddenRoleLogic);
    }
    expect(source).not.toMatch(forbiddenRoleLogic);
  });

  it.each(deniedQuestions)(
    "denies a worker asking %s without leaking another code",
    async (intent, question) => {
      const answer = await askQuestion(database.asD1(), "P-W1", question, now);

      expect(answer).toMatchObject({ intent, matched: true, denied: true });
      for (const code of ["P-A2", "P-B1", "P-MANAGER-A", "P-OWNER"]) {
        expect(answer.text).not.toContain(code);
      }
    },
  );

  it.each([
    ["ใครมีงานค้างมากที่สุด", "P-A2", "P-B1"],
    ["งานที่เกินกำหนดของทีม", "T-A2-OVER", "T-B-OVER"],
  ])(
    "lets a manager see the same department but not another for %s",
    async (question, visibleValue, hiddenValue) => {
      const answer = await askQuestion(
        database.asD1(),
        "P-MANAGER-A",
        question,
        now,
      );

      expect(answer.text).toContain(visibleValue);
      expect(answer.text).not.toContain(hiddenValue);
    },
  );

  it("scopes the same monthly statistic to fewer rows for a worker than an owner", async () => {
    const worker = await askQuestion(
      database.asD1(),
      "P-W1",
      "งานเสร็จกี่ใบเดือนนี้",
      now,
    );
    const owner = await askQuestion(
      database.asD1(),
      "P-OWNER",
      "งานเสร็จกี่ใบเดือนนี้",
      now,
    );

    expect(worker.text).toContain("2 งาน");
    expect(owner.text).toContain("5 งาน");
  });

  it("keeps a worker's new-today count unchanged and hides unassigned work", async () => {
    const answer = await askQuestion(
      database.asD1(),
      "P-W1",
      "วันนี้มีงานใหม่กี่ใบ",
      now,
    );

    expect(answer.text).toContain("2 งาน");
    expect(answer.text).not.toContain("ยังไม่มีผู้รับ");
    expect(answer.text).not.toContain("T-UNASSIGNED");
  });

  it("memoises canView once per distinct target for one question", async () => {
    const base = database.asD1();
    let personQueries = 0;
    const countingDb = {
      prepare(query: string): D1PreparedStatement {
        if (/FROM person WHERE person_code = \?/i.test(query)) personQueries += 1;
        return base.prepare(query);
      },
    } as unknown as D1Database;

    const answer = await askQuestion(
      countingDb,
      "P-MANAGER-A",
      "ใครมีงานค้างมากที่สุด",
      now,
    );

    expect(answer.text).toContain("P-A2");
    // One actor read for the answer, then one read for every other person in
    // the headcount scope. The actor is reused from the visibility memo.
    expect(personQueries).toBe(5);
  });

  it("returns no partial data when canView throws", async () => {
    const base = database.asD1();
    let personQueries = 0;
    const failingVisibilityDb = {
      prepare(query: string): D1PreparedStatement {
        if (/FROM person WHERE person_code = \?/i.test(query)) {
          personQueries += 1;
          if (personQueries > 1) throw new Error("visibility lookup failed");
        }
        return base.prepare(query);
      },
    } as unknown as D1Database;

    const answer = await askQuestion(
      failingVisibilityDb,
      "P-MANAGER-A",
      "ใครมีงานค้างมากที่สุด",
      now,
    );

    expect(answer.text).toContain("อ่านข้อมูลไม่ได้");
    for (const code of ["P-W1", "P-A2", "P-B1"]) {
      expect(answer.text).not.toContain(code);
    }
  });

  it("surfaces a bounded team-query failure instead of reporting an empty team", async () => {
    const base = database.asD1();
    const failingTeamDb = {
      prepare(query: string): D1PreparedStatement {
        if (/\bFROM\s+task\b/i.test(query)) {
          throw new Error("team task query failed");
        }
        return base.prepare(query);
      },
    } as unknown as D1Database;

    const answer = await askQuestion(
      failingTeamDb,
      "P-MANAGER-A",
      "สรุปงานวันนี้ทั้งทีม",
      now,
    );

    expect(answer.text).toContain("อ่านข้อมูลไม่ได้");
    expect(answer.text).not.toContain("งานใหม่วันนี้ 0 งาน");
    expect(answer.text).not.toContain("ไม่มีงาน");
  });

  it("returns no data and does not throw for an unknown actor on self and team intents", async () => {
    const selfAnswer = await askQuestion(
      database.asD1(),
      "P-MISSING",
      "งานของฉันมีอะไรบ้าง",
      now,
    );
    const teamAnswer = await askQuestion(
      database.asD1(),
      "P-MISSING",
      "ใครมีงานค้างมากที่สุด",
      now,
    );

    expect(selfAnswer.text).toContain("ไม่พบข้อมูลผู้ใช้งาน");
    expect(teamAnswer.text).toContain("ไม่พบข้อมูลผู้ใช้งาน");
    expect(selfAnswer.text).not.toContain("T-");
    expect(teamAnswer.text).not.toContain("P-A2");
  });
});

describe("bad input and empty data", () => {
  it("returns the specified unmatched answer for empty and garbage text", async () => {
    for (const question of ["", "   ", "กุ้งทะเลสีรุ้ง"]) {
      const answer = await askQuestion(database.asD1(), "P-W1", question, now);
      expect(answer).toEqual({
        intent: "unmatched",
        text: "น้องกุ้งยังไม่เข้าใจคำถามนี้ ลองพิมพ์ว่า \"AI ช่วยอะไรได้บ้าง\" เพื่อดูสิ่งที่น้องกุ้งตอบได้นะคะ",
        matched: false,
        denied: false,
      });
    }
  });

  it("states several empty result sets plainly without fabricating a number", async () => {
    const empty = new SQLiteD1();
    try {
      await insertPerson(empty, "P-EMPTY-W", "operations", "worker");
      await insertPerson(empty, "P-EMPTY-O", "management", "owner");
      const questions: Array<[string, string]> = [
        ["P-EMPTY-W", "งานที่เกินกำหนดแล้ว"],
        ["P-EMPTY-W", "งานที่เสร็จวันนี้"],
        ["P-EMPTY-O", "งานที่ยังไม่มีคนรับ"],
        ["P-EMPTY-W", "เวลาเฉลี่ยตั้งแต่รับงานถึงเสร็จงาน"],
      ];
      for (const [actor, question] of questions) {
        const answer = await askQuestion(empty.asD1(), actor, question, now);
        expect(answer.text).toContain("ไม่มี");
        expect(answer.text).not.toMatch(/\d/);
      }
    } finally {
      empty.close();
    }
  });

  it("turns a D1 prepare failure into an actionable answer", async () => {
    const broken = {
      prepare(): never {
        throw new Error("D1 unavailable");
      },
    } as unknown as D1Database;

    await expect(
      askQuestion(broken, "P-W1", "งานของฉันมีอะไรบ้าง", now),
    ).resolves.toMatchObject({
      intent: "my_tasks",
      matched: true,
      denied: false,
      text: expect.stringContaining("กรุณาลองถามอีกครั้ง"),
    });
  });
});

async function seedScenario(db: SQLiteD1): Promise<void> {
  await insertPerson(db, "P-OWNER", "management", "owner");
  await insertPerson(db, "P-MANAGER-A", "operations", "manager");
  await insertPerson(db, "P-W1", "operations", "worker");
  await insertPerson(db, "P-A2", "operations", "worker");
  await insertPerson(db, "P-B1", "finance", "worker");

  const tasks: TaskSeed[] = [
    {
      ref: "T-W-OPEN",
      title: "ตรวจเอกสาร",
      status: "assigned",
      assignee: "P-W1",
      createdAt: "2026-08-27T08:00:00.000Z",
      dueAt: "2026-08-27T12:00:00.000Z",
    },
    {
      ref: "T-W-OVER",
      title: "แก้ใบขน",
      status: "blocked",
      assignee: "P-W1",
      createdAt: "2026-08-25T00:00:00.000Z",
      dueAt: "2026-08-26T00:00:00.000Z",
      acceptedAt: "2026-08-25T01:00:00.000Z",
    },
    {
      ref: "T-W-DONE-TODAY",
      title: "ส่งรายงาน",
      status: "completed",
      assignee: "P-W1",
      createdAt: "2026-08-27T05:00:00.000Z",
      acceptedAt: "2026-08-27T06:00:00.000Z",
      completedAt: "2026-08-27T08:00:00.000Z",
    },
    {
      ref: "T-W-DONE-WEEK",
      title: "ตรวจสินค้า",
      status: "completed",
      assignee: "P-W1",
      createdAt: "2026-08-24T00:00:00.000Z",
      acceptedAt: "2026-08-24T01:00:00.000Z",
      completedAt: "2026-08-24T03:00:00.000Z",
    },
    {
      ref: "T-W-REJECT",
      title: "งานข้อมูลไม่ครบ",
      status: "rejected",
      assignee: "P-W1",
      createdAt: "2026-08-20T00:00:00.000Z",
    },
    {
      ref: "T-A2-ASSIGNED",
      title: "รับเอกสาร",
      status: "assigned",
      assignee: "P-A2",
      createdAt: "2026-08-27T08:30:00.000Z",
      dueAt: "2026-08-28T00:00:00.000Z",
    },
    {
      ref: "T-A2-OPEN",
      title: "ตรวจพิกัด",
      status: "accepted",
      assignee: "P-A2",
      createdAt: "2026-08-26T20:00:00.000Z",
      acceptedAt: "2026-08-26T20:10:00.000Z",
      dueAt: "2026-08-28T00:00:00.000Z",
    },
    {
      ref: "T-A2-OVER",
      title: "ติดตามของ",
      status: "in_progress",
      assignee: "P-A2",
      createdAt: "2026-08-24T00:00:00.000Z",
      acceptedAt: "2026-08-24T00:20:00.000Z",
      dueAt: "2026-08-26T01:00:00.000Z",
    },
    {
      ref: "T-A2-DONE",
      title: "ปิดแฟ้ม",
      status: "completed",
      assignee: "P-A2",
      createdAt: "2026-08-27T04:00:00.000Z",
      acceptedAt: "2026-08-27T04:10:00.000Z",
      completedAt: "2026-08-27T05:10:00.000Z",
    },
    {
      ref: "T-A2-REJECT",
      title: "งานผิดแผนก",
      status: "rejected",
      assignee: "P-A2",
      createdAt: "2026-08-21T00:00:00.000Z",
    },
    {
      ref: "T-B-OPEN",
      title: "งานการเงิน",
      status: "accepted",
      assignee: "P-B1",
      createdAt: "2026-08-27T04:00:00.000Z",
      acceptedAt: "2026-08-27T04:30:00.000Z",
    },
    {
      ref: "T-B-OVER",
      title: "งานการเงินเกินกำหนด",
      status: "in_progress",
      assignee: "P-B1",
      createdAt: "2026-08-24T00:00:00.000Z",
      acceptedAt: "2026-08-24T01:00:00.000Z",
      dueAt: "2026-08-25T00:00:00.000Z",
    },
    {
      ref: "T-B-DONE",
      title: "จ่ายค่าธรรมเนียม",
      status: "completed",
      assignee: "P-B1",
      createdAt: "2026-08-27T02:00:00.000Z",
      acceptedAt: "2026-08-27T02:30:00.000Z",
      completedAt: "2026-08-27T03:00:00.000Z",
    },
    {
      ref: "T-B-REJECT",
      title: "รายการซ้ำ",
      status: "rejected",
      assignee: "P-B1",
      createdAt: "2026-08-22T00:00:00.000Z",
    },
    {
      ref: "T-O-DONE",
      title: "อนุมัติงาน",
      status: "completed",
      assignee: "P-OWNER",
      createdAt: "2026-08-26T18:00:00.000Z",
      acceptedAt: "2026-08-26T19:00:00.000Z",
      completedAt: "2026-08-26T20:00:00.000Z",
    },
    {
      ref: "T-UNASSIGNED",
      title: "งานรอจัดคน",
      status: "draft",
      assignee: null,
      createdAt: "2026-08-27T07:00:00.000Z",
    },
    {
      ref: "T-UNASSIGNED-OPEN",
      title: "งานเปิดที่รอจัดคน",
      status: "assigned",
      assignee: null,
      createdAt: "2026-08-27T07:30:00.000Z",
    },
  ];
  for (const task of tasks) await insertTask(db, task);

  await insertEvent(db, "T-W-OPEN", "assigned", "2026-08-27T08:30:00.000Z");
  await insertEvent(db, "T-A2-ASSIGNED", "assigned", "2026-08-27T08:30:00.000Z");
  await insertEvent(db, "T-W-REJECT", "rejected", "2026-08-20T01:00:00.000Z");
  await insertEvent(db, "T-A2-REJECT", "rejected", "2026-08-21T01:00:00.000Z");
  await insertEvent(db, "T-B-REJECT", "rejected", "2026-08-22T01:00:00.000Z");

  const inbox = db
    .asD1()
    .prepare(
      `INSERT INTO inbox_event
       (event_id, event_type, message_type, source_type, occurred_at, received_at,
        payload_bytes, payload_sha256, status)
       VALUES (?, 'message', 'text', 'group', ?, ?, ?, ?, 'done')`,
    )
    .bind(
      "evt-status",
      "2026-08-27T08:54:00.000Z",
      "2026-08-27T08:55:00.000Z",
      1,
      "a".repeat(64),
    );
  await inbox.run();
  await db
    .asD1()
    .prepare(
      `INSERT INTO job_queue
       (event_id, kind, status, next_run_at, idem_key, event_occurred_at)
       VALUES (?, 'line_event', 'pending', ?, ?, ?)` ,
    )
    .bind(
      "evt-status",
      "2026-08-27T09:01:00.000Z",
      "job-status",
      "2026-08-27T08:54:00.000Z",
    )
    .run();
  await db
    .asD1()
    .prepare(
      `INSERT INTO ledger (action_type, outcome, occurred_at)
       VALUES ('cron_tick', 'ok', ?)` ,
    )
    .bind("2026-08-27T08:50:00.000Z")
    .run();
}

async function insertPerson(
  db: SQLiteD1,
  personCode: string,
  department: string,
  role: string,
): Promise<void> {
  await db
    .asD1()
    .prepare("INSERT INTO person (person_code, department, role) VALUES (?, ?, ?)")
    .bind(personCode, department, role)
    .run();
}

async function insertTask(db: SQLiteD1, task: TaskSeed): Promise<void> {
  await db
    .asD1()
    .prepare(
      `INSERT INTO task
       (task_ref, title, status, assignee_person_code, created_at, updated_at,
        due_at, accepted_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)` ,
    )
    .bind(
      task.ref,
      task.title,
      task.status,
      task.assignee,
      task.createdAt,
      task.createdAt,
      task.dueAt ?? null,
      task.acceptedAt ?? null,
      task.completedAt ?? null,
    )
    .run();
}

async function insertEvent(
  db: SQLiteD1,
  taskRef: string,
  newStatus: string,
  occurredAt: string,
): Promise<void> {
  await db
    .asD1()
    .prepare(
      `INSERT INTO task_event (task_ref, new_status, source, occurred_at)
       VALUES (?, ?, 'system', ?)` ,
    )
    .bind(taskRef, newStatus, occurredAt)
    .run();
}

describe("ข้อความที่คนอ่านจริง", () => {
  it("แสดงสถานะเป็นภาษาไทย และเลขงานที่ซิงก์มาเป็น 'งาน #<เลข>'", async () => {
    const db = new SQLiteD1();
    try {
      await insertPerson(db, "P-X", "operations", "worker");
      await insertTask(db, {
        ref: "L-22", title: "เช็ค SAP stock", status: "in_progress",
        assignee: "P-X", createdAt: "2026-08-20T01:00:00.000Z",
      });
      const answer = await askQuestion(db.asD1(), "P-X", "งานค้าง", now);

      // คนอ่านคือพนักงาน ⇒ ห้ามมีสถานะภาษาอังกฤษดิบ และห้ามมีเลขอ้างอิงภายในแบบ L-22
      expect(answer.text).toContain("งาน #22");
      expect(answer.text).toContain("(กำลังทำ)");
      expect(answer.text).not.toContain("in_progress");
      expect(answer.text).not.toContain("L-22");
    } finally {
      db.close();
    }
  });

  it("สถานะที่ยังไม่ได้แปลต้องโผล่ให้เห็น ไม่ถูกกลบเป็นคำรวม", async () => {
    const db = new SQLiteD1();
    try {
      await insertPerson(db, "P-Y", "operations", "worker");
      await insertTask(db, {
        ref: "T-HAND-1", title: "ใบใส่มือ", status: "blocked",
        assignee: "P-Y", createdAt: "2026-08-20T01:00:00.000Z",
      });
      const answer = await askQuestion(db.asD1(), "P-Y", "งานค้าง", now);
      // ใบที่ไม่ได้มาจาก LIVE ต้องคงเลขอ้างอิงเดิม ไม่ไปแต่งให้ดูเหมือนกัน
      expect(answer.text).toContain("T-HAND-1");
      expect(answer.text).toContain("(ติดปัญหา)");
    } finally {
      db.close();
    }
  });
});
