import {
  queryAcceptTimeCandidates,
  queryCompletedMonthCandidates,
  queryCycleTimeCandidates,
  queryMyCompletedTasks,
  queryMyLatestAssignedTask,
  queryMyNextTask,
  queryMyOpenTasks,
  queryMyOverdueTasks,
  queryMyTasks,
  queryNewTodayCandidates,
  queryRejectedMonthCandidates,
  querySystemStatus,
  queryTeamOpenCandidates,
  queryTeamOverdueCandidates,
  queryTeamRejectedCandidates,
  queryTeamTodayCandidates,
  queryTeamUnacceptedTasks,
  queryTeamUnassignedTasks,
  type AssignedTaskQueryRow,
  type TaskQueryRow,
} from "./db/queries.ts";
import {
  canAskTeamQuestion,
  canView,
  canViewUnassigned,
  readPerson,
  type PersonRow,
} from "./visibility.ts";

export interface Answer {
  intent: string;
  text: string;
  matched: boolean;
  denied: boolean;
}

export interface UtcRange {
  startUtc: string;
  endUtc: string;
}

type IntentId =
  | "my_tasks"
  | "my_open"
  | "my_overdue"
  | "my_done_today"
  | "my_done_week"
  | "my_next"
  | "my_latest_assigned"
  | "team_unaccepted"
  | "team_most_open"
  | "team_overdue"
  | "team_today"
  | "team_rejected"
  | "team_unassigned"
  | "stats_completed_month"
  | "stats_rejected_month"
  | "stats_avg_cycle"
  | "stats_fastest_accept"
  | "stats_new_today"
  | "help"
  | "system_status";

interface IntentDefinition {
  id: IntentId;
  menuOrder: number;
  menuText: string;
  rules: readonly (readonly [string, ...string[]])[];
}

// Matching order is deliberate: specific team/statistical intents precede self intents;
// the two general utility intents come last. Ambiguous short forms are exact matches only.
const intentDefinitions: readonly IntentDefinition[] = [
  {
    id: "team_unassigned",
    menuOrder: 13,
    menuText: "งานที่ยังไม่มีคนรับ",
    rules: [
      ["งาน", "ยังไม่มีคนรับ"],
      ["งาน", "ยังไม่มีผู้รับ"],
      ["งาน", "ยังไม่ได้มอบหมาย"],
    ],
  },
  {
    id: "team_unaccepted",
    menuOrder: 8,
    menuText: "ใครยังไม่รับงาน",
    rules: [
      ["ใคร", "ยังไม่รับงาน"],
      ["ใคร", "ไม่รับงาน"],
      ["มอบหมาย", "งาน", "ยังไม่รับ"],
    ],
  },
  {
    id: "team_most_open",
    menuOrder: 9,
    menuText: "ใครมีงานค้างมากที่สุด",
    rules: [
      ["ใคร", "งาน", "ค้าง"],
      ["คนไหน", "งาน", "ค้าง"],
      ["งาน", "ค้าง", "ทีม"],
      ["งาน", "ค้าง", "ทุกคน"],
      ["งาน", "ค้าง", "คนอื่น"],
    ],
  },
  {
    id: "team_overdue",
    menuOrder: 10,
    menuText: "งานที่เกินกำหนดของทีม",
    rules: [["งาน", "เกินกำหนด", "ทีม"], ["ทีม", "งาน", "เลยกำหนด"]],
  },
  {
    id: "team_today",
    menuOrder: 11,
    menuText: "สรุปงานวันนี้ทั้งทีม",
    rules: [
      ["สรุป", "งาน", "วันนี้"],
      ["วันนี้", "ทีม", "งาน"],
      ["วันนี้", "ทุกคน", "งาน"],
      ["วันนี้", "คนอื่น", "งาน"],
    ],
  },
  {
    id: "stats_rejected_month",
    menuOrder: 15,
    menuText: "งานถูกปฏิเสธกี่ใบเดือนนี้",
    rules: [["งาน", "ปฏิเสธ", "เดือนนี้"]],
  },
  {
    id: "team_rejected",
    menuOrder: 12,
    menuText: "ใครปฏิเสธงานบ้าง",
    rules: [["ใคร", "ปฏิเสธ", "งาน"]],
  },
  {
    id: "stats_fastest_accept",
    menuOrder: 17,
    menuText: "ใครรับงานเร็วที่สุด",
    rules: [["ใคร", "รับ", "งาน", "เร็ว"], ["คนไหน", "รับ", "งาน", "ไว"]],
  },
  {
    id: "stats_avg_cycle",
    menuOrder: 16,
    menuText: "เวลาเฉลี่ยตั้งแต่รับงานถึงเสร็จงาน",
    rules: [["งาน", "เฉลี่ย", "รับ", "เสร็จ"]],
  },
  {
    id: "stats_completed_month",
    menuOrder: 14,
    menuText: "งานเสร็จกี่ใบเดือนนี้",
    rules: [["งาน", "เสร็จ", "เดือนนี้"]],
  },
  {
    id: "stats_new_today",
    menuOrder: 18,
    menuText: "วันนี้มีงานใหม่กี่ใบ",
    rules: [["วันนี้", "งานใหม่"], ["งานเข้าใหม่", "วันนี้"]],
  },
  {
    id: "my_done_today",
    menuOrder: 4,
    menuText: "งานที่เสร็จวันนี้",
    rules: [["งาน", "เสร็จ", "วันนี้"]],
  },
  {
    id: "my_done_week",
    menuOrder: 5,
    menuText: "งานที่เสร็จสัปดาห์นี้",
    rules: [["งาน", "เสร็จ", "สัปดาห์นี้"], ["สัปดาห์นี้", "ปิดงาน"]],
  },
  {
    id: "my_latest_assigned",
    menuOrder: 7,
    menuText: "งานล่าสุดที่ได้รับมอบหมาย",
    rules: [["งานล่าสุด", "มอบหมาย"], ["เพิ่งมอบหมาย", "งาน"]],
  },
  {
    id: "my_next",
    menuOrder: 6,
    menuText: "งานถัดไปที่ต้องทำ",
    rules: [["งานถัดไป", "ต้องทำ"], ["งานไหน", "ทำต่อ"]],
  },
  {
    id: "my_overdue",
    menuOrder: 3,
    menuText: "งานที่เกินกำหนดแล้ว",
    rules: [["งาน", "เกินกำหนด"], ["งาน", "เลยกำหนด"], ["งาน", "overdue"]],
  },
  {
    id: "my_open",
    menuOrder: 2,
    menuText: "งานที่ค้างอยู่ตอนนี้",
    rules: [
      ["งาน", "ค้าง", "ตอนนี้"],
      ["ฉัน", "งานค้าง"],
      ["ของฉัน", "งานค้าง"],
    ],
  },
  {
    id: "my_tasks",
    menuOrder: 1,
    menuText: "งานของฉันมีอะไรบ้าง",
    rules: [
      ["งานของฉัน", "อะไรบ้าง"],
      ["งานฉัน", "อะไรบ้าง"],
      ["มีงาน", "อะไรบ้าง"],
      ["ดูงาน", "ทั้งหมด"],
      ["งานของฉัน", "สถานะ"],
      ["งานฉัน", "สถานะ"],
      ["สถานะงาน", "ของฉัน"],
    ],
  },
  {
    id: "help",
    menuOrder: 19,
    menuText: "AI ช่วยอะไรได้บ้าง",
    rules: [["ช่วยอะไรได้"], ["ทำอะไรได้"], ["เมนู", "คำถาม"]],
  },
  {
    id: "system_status",
    menuOrder: 20,
    menuText: "สถานะระบบ",
    rules: [["สถานะ", "ระบบ"], ["ระบบ", "ทำงาน"]],
  },
];

const exactIntentPhrases = new Map<string, IntentId>([
  ["งานของฉัน", "my_tasks"],
  ["งานค้าง", "my_open"],
  ["งานถัดไป", "my_next"],
  ["ใครยังไม่รับ", "team_unaccepted"],
  ["ใครงานค้างเยอะ", "team_most_open"],
  ["สรุปวันนี้", "team_today"],
  ["ใครปฏิเสธ", "team_rejected"],
  ["งานว่าง", "team_unassigned"],
  ["งานล่าสุด", "my_latest_assigned"],
  ["เฉลี่ยใช้เวลากี่นาที", "stats_avg_cycle"],
  ["ใครรับเร็วสุด", "stats_fastest_accept"],
]);

const teamOnlyIntents = new Set<IntentId>([
  "team_unaccepted",
  "team_most_open",
  "team_overdue",
  "team_today",
  "team_rejected",
  "team_unassigned",
  "stats_fastest_accept",
]);

const openStatuses = new Set([
  "assigned",
  "accepted",
  "en_route",
  "arrived",
  "in_progress",
  "blocked",
]);

const thaiOffsetMilliseconds = 7 * 60 * 60 * 1_000;
const thaiMonthAbbreviations = [
  "ม.ค.",
  "ก.พ.",
  "มี.ค.",
  "เม.ย.",
  "พ.ค.",
  "มิ.ย.",
  "ก.ค.",
  "ส.ค.",
  "ก.ย.",
  "ต.ค.",
  "พ.ย.",
  "ธ.ค.",
] as const;

export function thaiDayRange(now: string): UtcRange {
  const local = thaiLocalDate(now);
  return {
    startUtc: thaiMidnightUtc(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
    ),
    endUtc: thaiMidnightUtc(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() + 1,
    ),
  };
}

export function thaiWeekRange(now: string): UtcRange {
  const local = thaiLocalDate(now);
  const daysSinceMonday = (local.getUTCDay() + 6) % 7;
  return {
    startUtc: thaiMidnightUtc(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() - daysSinceMonday,
    ),
    endUtc: thaiMidnightUtc(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() - daysSinceMonday + 7,
    ),
  };
}

export function thaiMonthRange(now: string): UtcRange {
  const local = thaiLocalDate(now);
  return {
    startUtc: thaiMidnightUtc(local.getUTCFullYear(), local.getUTCMonth(), 1),
    endUtc: thaiMidnightUtc(local.getUTCFullYear(), local.getUTCMonth() + 1, 1),
  };
}

export function thaiDisplayTime(utcIso: string): string {
  const local = thaiLocalDate(utcIso);
  const hours = String(local.getUTCHours()).padStart(2, "0");
  const minutes = String(local.getUTCMinutes()).padStart(2, "0");
  const buddhistYear = local.getUTCFullYear() + 543;
  return `${local.getUTCDate()} ${thaiMonthAbbreviations[local.getUTCMonth()]} ${buddhistYear} ${hours}:${minutes} น.`;
}

export function matchQuestionIntent(question: string): string | null {
  const normalized = normalizeQuestion(question);
  if (normalized === "") return null;
  if (isCompletionStatement(normalized)) return null;
  const exactIntent = exactIntentPhrases.get(normalized);
  if (exactIntent) return exactIntent;
  return (
    intentDefinitions.find((definition) =>
      definition.rules.some((rule) =>
        rule.every((keyword) => normalized.includes(keyword)),
      ),
    )?.id ?? null
  );
}

export async function askQuestion(
  db: D1Database,
  actorPersonCode: string,
  question: string,
  now: string,
): Promise<Answer> {
  const intent = matchQuestionIntent(question) as IntentId | null;
  if (!intent) {
    return {
      intent: "unmatched",
      text: "น้องกุ้งยังไม่เข้าใจคำถามนี้ ลองพิมพ์ว่า \"AI ช่วยอะไรได้บ้าง\" เพื่อดูสิ่งที่น้องกุ้งตอบได้นะคะ",
      matched: false,
      denied: false,
    };
  }

  try {
    const actor = await readPerson(db, actorPersonCode);
    if (!actor) {
      return matchedAnswer(
        intent,
        "น้องกุ้งไม่พบข้อมูลผู้ใช้งานของพี่ กรุณาเชื่อมบัญชีกับรหัสพนักงานก่อน แล้วลองถามอีกครั้งค่ะ",
      );
    }

    if (teamOnlyIntents.has(intent) && !canAskTeamQuestion(actor)) {
      return {
        intent,
        text: "น้องกุ้งขออภัย คำถามข้อมูลทีมใช้ได้เฉพาะผู้จัดการหรือเจ้าของระบบ พี่ยังถามว่า \"งานของฉันมีอะไรบ้าง\" หรือ \"AI ช่วยอะไรได้บ้าง\" ได้ค่ะ",
        matched: true,
        denied: true,
      };
    }

    return await answerIntent(db, actor, intent, now);
  } catch {
    return matchedAnswer(
      intent,
      "น้องกุ้งอ่านข้อมูลไม่ได้ในขณะนี้ กรุณาลองถามอีกครั้ง หากยังพบปัญหาให้แจ้งผู้ดูแลระบบพร้อมคำถามเดิมค่ะ",
    );
  }
}

async function answerIntent(
  db: D1Database,
  actor: PersonRow,
  intent: IntentId,
  now: string,
): Promise<Answer> {
  const canSee = createVisibilityMemo(db, actor.personCode);

  switch (intent) {
    case "my_tasks": {
      const rows = await queryMyTasks(db, actor.personCode);
      return matchedAnswer(
        intent,
        taskListText(
          rows,
          `น้องกุ้งพบงานของพี่ ${rows.length} งาน`,
          "น้องกุ้งตรวจแล้ว ไม่พบงานที่ยังไม่จบของพี่ค่ะ",
        ),
      );
    }
    case "my_open": {
      const rows = await queryMyOpenTasks(db, actor.personCode);
      return matchedAnswer(
        intent,
        taskListText(
          rows,
          `น้องกุ้งพบงานของพี่ที่ค้างอยู่ ${rows.length} งาน`,
          "น้องกุ้งตรวจแล้ว ไม่มีงานค้างของพี่ค่ะ",
        ),
      );
    }
    case "my_overdue": {
      const rows = await queryMyOverdueTasks(db, actor.personCode, now);
      return matchedAnswer(
        intent,
        taskListText(
          rows,
          `น้องกุ้งพบงานของพี่ที่เกินกำหนด ${rows.length} งาน`,
          "น้องกุ้งตรวจแล้ว ไม่มีงานของพี่ที่เกินกำหนดค่ะ",
        ),
      );
    }
    case "my_done_today": {
      const range = thaiDayRange(now);
      const rows = await queryMyCompletedTasks(
        db,
        actor.personCode,
        range.startUtc,
        range.endUtc,
      );
      return matchedAnswer(
        intent,
        taskListText(
          rows,
          `น้องกุ้งพบงานที่พี่ทำเสร็จวันนี้ ${rows.length} งาน`,
          "น้องกุ้งตรวจแล้ว วันนี้ยังไม่มีงานของพี่ที่เสร็จค่ะ",
        ),
      );
    }
    case "my_done_week": {
      const range = thaiWeekRange(now);
      const rows = await queryMyCompletedTasks(
        db,
        actor.personCode,
        range.startUtc,
        range.endUtc,
      );
      return matchedAnswer(
        intent,
        taskListText(
          rows,
          `น้องกุ้งพบงานที่พี่ทำเสร็จสัปดาห์นี้ ${rows.length} งาน`,
          "น้องกุ้งตรวจแล้ว สัปดาห์นี้ยังไม่มีงานของพี่ที่เสร็จค่ะ",
        ),
      );
    }
    case "my_next": {
      const [row] = await queryMyNextTask(db, actor.personCode);
      return matchedAnswer(
        intent,
        row
          ? `น้องกุ้งเรียงจากกำหนดส่งและเวลานัดแล้ว งานของพี่ถัดไปคือ ${taskText(row)}ค่ะ`
          : "น้องกุ้งตรวจแล้ว ไม่มีงานถัดไปที่ยังไม่จบค่ะ",
      );
    }
    case "my_latest_assigned": {
      const [row] = await queryMyLatestAssignedTask(db, actor.personCode);
      return matchedAnswer(
        intent,
        row
          ? `น้องกุ้งพบงานที่มอบหมายให้พี่ล่าสุดคือ ${taskText(row)}เมื่อ ${thaiDisplayTime(row.assigned_at)} ค่ะ`
          : "น้องกุ้งตรวจแล้ว ยังไม่มีประวัติงานที่มอบหมายให้พี่ค่ะ",
      );
    }
    case "team_unaccepted": {
      const rows = await visibleRows(await queryTeamUnacceptedTasks(db), canSee);
      if (rows.length === 0) {
        return matchedAnswer(
          intent,
          "น้องกุ้งตรวจแล้ว ไม่มีงานที่มอบหมายแล้วค้างรอรับในขอบเขตที่พี่ดูได้ค่ะ",
        );
      }
      const lines = rows.map(
        (row) =>
          `• ${row.assignee_person_code}: ${row.task_ref} รอรับมา ${durationText(
            Date.parse(now) - Date.parse(row.assigned_at),
          )}`,
      );
      return matchedAnswer(
        intent,
        `${lines.join("\n")}\nน้องกุ้งพบงานที่ยังไม่รับ ${rows.length} งานค่ะ`,
      );
    }
    case "team_most_open": {
      const rows = await visibleRows(await queryTeamOpenCandidates(db), canSee);
      if (rows.length === 0) {
        return matchedAnswer(
          intent,
          "น้องกุ้งตรวจแล้ว ไม่มีงานค้างในขอบเขตทีมที่พี่ดูได้ค่ะ",
        );
      }
      const ranked = countByAssignee(rows);
      const leader = ranked[0];
      if (!leader) {
        return matchedAnswer(
          intent,
          "น้องกุ้งตรวจแล้ว ไม่มีผู้รับงานที่นำมาจัดอันดับได้ในขอบเขตทีมที่พี่ดูได้ กรุณาตรวจข้อมูลผู้รับงานแล้วลองถามอีกครั้งค่ะ",
        );
      }
      const leaders = ranked.filter((entry) => entry.count === leader.count);
      const shown = ranked.slice(0, 3);
      const lines = shown
        .map((entry, index) => `${index + 1}. ${entry.personCode}: ${entry.count} งาน`);
      const summary =
        leaders.length > 1
          ? `อันดับสูงสุดเท่ากัน ${leaders.length} คนที่ ${leader.count} งานค่ะ`
          : `${leader.personCode} มีงานค้างมากที่สุด ${leader.count} งานค่ะ`;
      const truncationText =
        shown.length < ranked.length
          ? `\nแสดง ${shown.length} จาก ${ranked.length} คน`
          : "";
      return matchedAnswer(
        intent,
        `น้องกุ้งจัดอันดับงานค้างในขอบเขตที่พี่ดูได้ดังนี้\n${lines.join("\n")}${truncationText}\n${summary}`,
      );
    }
    case "team_overdue": {
      const rows = await visibleRows(
        await queryTeamOverdueCandidates(db, now),
        canSee,
      );
      return matchedAnswer(
        intent,
        taskListText(
          rows,
          `น้องกุ้งพบงานเกินกำหนดของทีมที่พี่ดูได้ ${rows.length} งาน`,
          "น้องกุ้งตรวจแล้ว ไม่มีงานเกินกำหนดของทีมในขอบเขตที่พี่ดูได้ค่ะ",
          true,
        ),
      );
    }
    case "team_today": {
      const range = thaiDayRange(now);
      const rows = await visibleRows(
        await queryTeamTodayCandidates(db, range.startUtc, range.endUtc),
        canSee,
        canViewUnassigned(actor),
      );
      const newCount = rows.filter((row) => inRange(row.created_at, range)).length;
      const completedCount = rows.filter(
        (row) => row.completed_at && inRange(row.completed_at, range),
      ).length;
      const assignedOpenCount = rows.filter(
        (row) =>
          row.assignee_person_code !== null && openStatuses.has(row.status),
      ).length;
      const unassignedCount = rows.filter(
        (row) => row.assignee_person_code === null,
      ).length;
      const unassignedText =
        unassignedCount > 0
          ? ` และในจำนวนนี้ยังไม่มีผู้รับ ${unassignedCount} งาน`
          : "";
      return matchedAnswer(
        intent,
        `น้องกุ้งสรุปงานวันนี้ในขอบเขตทีมที่พี่ดูได้: งานใหม่ ${newCount} งาน งานเสร็จ ${completedCount} งาน งานที่มีผู้รับแล้วแต่ยังค้างอยู่ทั้งหมด ${assignedOpenCount} งาน${unassignedText}ค่ะ`,
      );
    }
    case "team_rejected": {
      const rows = await visibleRows(await queryTeamRejectedCandidates(db), canSee);
      return matchedAnswer(
        intent,
        taskListText(
          rows,
          `น้องกุ้งพบงานที่ถูกปฏิเสธในขอบเขตทีม ${rows.length} งาน`,
          "น้องกุ้งตรวจแล้ว ไม่มีงานที่ถูกปฏิเสธในขอบเขตทีมที่พี่ดูได้ค่ะ",
          true,
        ),
      );
    }
    case "team_unassigned": {
      const rows = await queryTeamUnassignedTasks(db);
      return matchedAnswer(
        intent,
        taskListText(
          rows,
          `น้องกุ้งพบงานที่ยังไม่มีผู้รับ ${rows.length} งาน`,
          "น้องกุ้งตรวจแล้ว ไม่มีงานที่ยังไม่ได้มอบหมายค่ะ",
        ),
      );
    }
    case "stats_completed_month": {
      const range = thaiMonthRange(now);
      const rows = await visibleRows(
        await queryCompletedMonthCandidates(db, range.startUtc, range.endUtc),
        canSee,
      );
      return matchedAnswer(
        intent,
        rows.length === 0
          ? "น้องกุ้งตรวจแล้ว เดือนนี้ไม่มีงานที่เสร็จในขอบเขตที่พี่ดูได้ค่ะ"
          : `น้องกุ้งตรวจแล้ว เดือนนี้มีงานเสร็จ ${rows.length} งานในขอบเขตที่พี่ดูได้ค่ะ`,
      );
    }
    case "stats_rejected_month": {
      const range = thaiMonthRange(now);
      const rows = await visibleRows(
        await queryRejectedMonthCandidates(db, range.startUtc, range.endUtc),
        canSee,
      );
      return matchedAnswer(
        intent,
        rows.length === 0
          ? "น้องกุ้งตรวจแล้ว เดือนนี้ไม่มีงานถูกปฏิเสธในขอบเขตที่พี่ดูได้ค่ะ"
          : `น้องกุ้งตรวจแล้ว เดือนนี้มีงานถูกปฏิเสธ ${rows.length} งานในขอบเขตที่พี่ดูได้ค่ะ`,
      );
    }
    case "stats_avg_cycle": {
      const range = thaiMonthRange(now);
      const rows = await visibleRows(
        await queryCycleTimeCandidates(db, range.startUtc, range.endUtc),
        canSee,
      );
      if (rows.length === 0) {
        return matchedAnswer(
          intent,
          "น้องกุ้งยังคำนวณเวลาเฉลี่ยไม่ได้ เพราะเดือนนี้ไม่มีงานที่มีทั้งเวลารับและเวลาเสร็จในขอบเขตที่พี่ดูได้ค่ะ",
        );
      }
      const totalMilliseconds = rows.reduce(
        (total, row) =>
          total + (Date.parse(row.completed_at ?? "") - Date.parse(row.accepted_at ?? "")),
        0,
      );
      return matchedAnswer(
        intent,
        `น้องกุ้งคำนวณจาก ${rows.length} งานแล้ว เวลาเฉลี่ยตั้งแต่รับถึงเสร็จคือ ${durationText(
          totalMilliseconds / rows.length,
        )}ค่ะ`,
      );
    }
    case "stats_fastest_accept": {
      const rows = await visibleRows(await queryAcceptTimeCandidates(db), canSee);
      const fastest = fastestAverageAccept(rows);
      if (!fastest) {
        return matchedAnswer(
          intent,
          "น้องกุ้งยังหาคนที่รับงานเร็วที่สุดไม่ได้ เพราะไม่มีงานที่มีเวลาสร้างและเวลารับในขอบเขตที่พี่ดูได้ค่ะ",
        );
      }
      return matchedAnswer(
        intent,
        `น้องกุ้งคำนวณแล้ว ${fastest.personCode} รับงานเร็วที่สุด เฉลี่ย ${durationText(
          fastest.averageMilliseconds,
        )}จาก ${fastest.count} งานค่ะ`,
      );
    }
    case "stats_new_today": {
      const range = thaiDayRange(now);
      const rows = await visibleRows(
        await queryNewTodayCandidates(db, range.startUtc, range.endUtc),
        canSee,
        canViewUnassigned(actor),
      );
      const unassignedCount = rows.filter(
        (row) => row.assignee_person_code === null,
      ).length;
      const unassignedText =
        unassignedCount > 0
          ? ` และในจำนวนนี้ยังไม่มีผู้รับ ${unassignedCount} งาน`
          : "";
      return matchedAnswer(
        intent,
        rows.length === 0
          ? "น้องกุ้งตรวจแล้ว วันนี้ไม่มีงานใหม่ในขอบเขตที่พี่ดูได้ค่ะ"
          : `น้องกุ้งตรวจแล้ว วันนี้มีงานใหม่ ${rows.length} งานในขอบเขตที่พี่ดูได้${unassignedText}ค่ะ`,
      );
    }
    case "help":
      return matchedAnswer(intent, helpText());
    case "system_status": {
      const status = await querySystemStatus(db);
      if (!status.latestInboxAt && !status.latestCronAt) {
        return matchedAnswer(intent, "น้องกุ้งตรวจแล้ว ยังไม่มีข้อมูลเข้ามาเลยค่ะ");
      }
      const inboxText = status.latestInboxAt
        ? `ข้อมูลเข้าล่าสุดเมื่อ ${thaiDisplayTime(status.latestInboxAt)}`
        : "ยังไม่มีข้อมูลรับเข้า";
      const cronText = status.latestCronAt
        ? `cron_tick ล่าสุดเมื่อ ${thaiDisplayTime(status.latestCronAt)} ผล ${status.latestCronOutcome ?? "ไม่มีข้อมูลผลลัพธ์"}`
        : "ยังไม่มีประวัติ cron_tick";
      return matchedAnswer(
        intent,
        `น้องกุ้งรายงานจากฐานข้อมูลจริง: ${inboxText} คิวที่รอประมวลผลมี ${status.pendingJobs} งาน ${cronText}ค่ะ`,
      );
    }
  }
}

function normalizeQuestion(question: string): string {
  return question
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^(?:ai\b\s*|เอไอ(?:\s+|$))/i, "")
    .trim()
    .toLowerCase();
}

function isCompletionStatement(question: string): boolean {
  return [
    /^งาน(?:ของ)?ฉัน.*เสร็จ.*แล้ว(?:ครับ|ค่ะ)?$/,
    /^วันนี้ทำงาน.*เสร็จ.*แล้ว(?:ครับ|ค่ะ)?$/,
    /^ไม่มีงาน.*แล้ว(?:ครับ|ค่ะ)?$/,
  ].some((pattern) => pattern.test(question));
}

function thaiLocalDate(now: string): Date {
  const parsed = Date.parse(now);
  if (!Number.isFinite(parsed)) throw new RangeError("Invalid UTC timestamp");
  return new Date(parsed + thaiOffsetMilliseconds);
}

function thaiMidnightUtc(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day) - thaiOffsetMilliseconds).toISOString();
}

function matchedAnswer(intent: IntentId, text: string): Answer {
  return { intent, text, matched: true, denied: false };
}

function createVisibilityMemo(
  db: D1Database,
  actorPersonCode: string,
): (targetPersonCode: string) => Promise<boolean> {
  const memo = new Map<string, Promise<boolean>>();
  return (targetPersonCode: string): Promise<boolean> => {
    const cached = memo.get(targetPersonCode);
    if (cached) return cached;
    // Keep the rejected promise in the per-call memo too. A visibility lookup
    // failure aborts the whole answer, so no partially filtered data can leak.
    const decision = canView(db, actorPersonCode, targetPersonCode);
    memo.set(targetPersonCode, decision);
    return decision;
  };
}

async function visibleRows<T extends { assignee_person_code: string | null }>(
  rows: T[],
  canSee: (targetPersonCode: string) => Promise<boolean>,
  includeUnassigned = false,
): Promise<T[]> {
  const decisions = await Promise.all(
    rows.map((row) =>
      row.assignee_person_code
        ? canSee(row.assignee_person_code)
        : Promise.resolve(includeUnassigned),
    ),
  );
  return rows.filter((_row, index) => decisions[index]);
}

function taskListText(
  rows: TaskQueryRow[],
  foundText: string,
  emptyText: string,
  showAssignee = false,
): string {
  if (rows.length === 0) return emptyText;
  const lines = rows.map((row) => {
    const assignee = showAssignee ? ` ผู้รับ ${row.assignee_person_code}` : "";
    return `• ${taskText(row)}${assignee}`.trimEnd();
  });
  return `${lines.join("\n")}\n${foundText}ค่ะ`;
}

function taskText(row: TaskQueryRow | AssignedTaskQueryRow): string {
  return `${row.task_ref}: ${row.title} สถานะ ${row.status} `;
}

function durationText(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} นาที`;
  const hours = Math.round((totalMinutes / 60) * 10) / 10;
  return `${hours} ชั่วโมง`;
}

function countByAssignee(
  rows: TaskQueryRow[],
): Array<{ personCode: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.assignee_person_code) continue;
    counts.set(row.assignee_person_code, (counts.get(row.assignee_person_code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([personCode, count]) => ({ personCode, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.personCode.localeCompare(right.personCode),
    );
}

function fastestAverageAccept(
  rows: TaskQueryRow[],
): { personCode: string; averageMilliseconds: number; count: number } | null {
  const grouped = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    if (!row.assignee_person_code || !row.accepted_at) continue;
    const duration = Date.parse(row.accepted_at) - Date.parse(row.created_at);
    const current = grouped.get(row.assignee_person_code) ?? { total: 0, count: 0 };
    current.total += duration;
    current.count += 1;
    grouped.set(row.assignee_person_code, current);
  }
  const ranked = [...grouped.entries()]
    .map(([personCode, value]) => ({
      personCode,
      averageMilliseconds: value.total / value.count,
      count: value.count,
    }))
    .sort(
      (left, right) =>
        left.averageMilliseconds - right.averageMilliseconds ||
        left.personCode.localeCompare(right.personCode),
    );
  return ranked[0] ?? null;
}

function inRange(value: string, range: UtcRange): boolean {
  return value >= range.startUtc && value < range.endUtc;
}

function helpText(): string {
  const lines = [...intentDefinitions]
    .sort((left, right) => left.menuOrder - right.menuOrder)
    .map(
      (definition) =>
        `${definition.menuOrder}. พิมพ์ว่า \"${definition.menuText}\" ได้`,
    );
  return `${lines.join("\n")}\nน้องกุ้งตอบคำถามที่ลงทะเบียนไว้ตามรายการนี้ค่ะ`;
}
