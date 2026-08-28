import {
  claimSummaryDelivery,
  finishSummaryDelivery,
  readLatestCronBefore,
  readLinkedPersonCodes,
  recordSummaryCatchupSkip,
  recordSummaryPassIssue,
  recordSummaryPersonIssue,
  recordSummaryTerminal,
} from "./db/repository.ts";
import { type Fetcher, sendTextNotification } from "./outbound.ts";
import {
  type Answer,
  askQuestion,
  thaiDayRange,
  thaiLocalDate,
} from "./queryEngine.ts";
import type { Env } from "./types.ts";

export type SummaryRound = "morning" | "evening";
export type SummaryAsker = (
  db: D1Database,
  personCode: string,
  question: string,
  now: string,
) => Promise<Answer>;

export interface ScheduledSummaryRound {
  round: SummaryRound;
  date: string;
  scheduledAt: string;
  delayed: boolean;
}

export interface SummaryRunResult {
  sent: number;
  empty: number;
  retried: number;
  dead: number;
  missed: number;
  configMissing: number;
  skippedHoliday: number;
  checkpointSafe: boolean;
}

export interface SummaryRoundSelection {
  rounds: ScheduledSummaryRound[];
  skipped: number;
}

export type SummaryBuildResult =
  | { status: "ready"; text: string }
  | { status: "empty" }
  | { status: "error" };

interface SummaryQuestion {
  label: string;
  question: string;
  teamOnly: boolean;
}

const maximumLatenessMilliseconds = 60 * 60_000;
const maximumRetryAttempts = 3;
const dayMilliseconds = 24 * 60 * 60_000;
export const MAX_SUMMARY_ROUNDS_PER_TICK = 4;

const morningQuestions: readonly SummaryQuestion[] = [
  { label: "งานที่ค้างอยู่ตอนนี้", question: "งานที่ค้างอยู่ตอนนี้", teamOnly: false },
  { label: "งานที่เกินกำหนดแล้ว", question: "งานที่เกินกำหนดแล้ว", teamOnly: false },
  { label: "งานถัดไปที่ต้องทำ", question: "งานถัดไปที่ต้องทำ", teamOnly: false },
  { label: "ใครยังไม่รับงาน", question: "ใครยังไม่รับงาน", teamOnly: true },
] as const;

const eveningQuestions: readonly SummaryQuestion[] = [
  { label: "งานที่เสร็จวันนี้", question: "งานที่เสร็จวันนี้", teamOnly: false },
  { label: "งานที่ยังค้าง", question: "งานที่ค้างอยู่ตอนนี้", teamOnly: false },
  { label: "สรุปงานวันนี้ทั้งทีม", question: "สรุปงานวันนี้ทั้งทีม", teamOnly: true },
] as const;

const emptyAnswerMarkers: Readonly<Record<string, string>> = {
  my_open: "ไม่มีงานค้างของพี่",
  my_overdue: "ไม่มีงานของพี่ที่เกินกำหนด",
  my_done_today: "วันนี้ยังไม่มีงานของพี่ที่เสร็จ",
  my_next: "ไม่มีงานถัดไปที่ยังไม่จบ",
  team_unaccepted: "ไม่มีงานที่มอบหมายแล้วค้างรอรับ",
};

export function summaryRoundsToProcess(
  now: string,
  latestCronBefore: string | null,
): SummaryRoundSelection {
  const nowMilliseconds = requiredTimestamp(now);
  const rounds = new Map<string, ScheduledSummaryRound>();
  const latest = latestScheduledRound(now);
  rounds.set(summaryReference(latest), latest);

  if (latestCronBefore !== null) {
    const previousMilliseconds = requiredTimestamp(latestCronBefore);
    let dayStart = requiredTimestamp(thaiDayRange(latestCronBefore).startUtc);
    const finalDayStart = requiredTimestamp(thaiDayRange(now).startUtc);
    for (; dayStart <= finalDayStart; dayStart += dayMilliseconds) {
      for (const [round, hour] of [
        ["morning", 8],
        ["evening", 17],
      ] as const) {
        const scheduledMilliseconds = dayStart + hour * 60 * 60_000;
        if (
          scheduledMilliseconds > previousMilliseconds &&
          scheduledMilliseconds <= nowMilliseconds
        ) {
          const candidate = scheduledRound(round, scheduledMilliseconds, nowMilliseconds);
          rounds.set(summaryReference(candidate), candidate);
        }
      }
    }
  }

  const ordered = [...rounds.values()].sort((left, right) =>
    left.scheduledAt.localeCompare(right.scheduledAt),
  );
  const skipped = Math.max(0, ordered.length - MAX_SUMMARY_ROUNDS_PER_TICK);
  return {
    rounds: skipped === 0 ? ordered : ordered.slice(-MAX_SUMMARY_ROUNDS_PER_TICK),
    skipped,
  };
}

export async function buildSummary(
  db: D1Database,
  personCode: string,
  round: ScheduledSummaryRound,
  now: string,
  asker: SummaryAsker = askQuestion,
): Promise<SummaryBuildResult> {
  const questions = round.round === "morning" ? morningQuestions : eveningQuestions;
  const sections: string[] = [];

  for (const item of questions) {
    let answer: Answer;
    try {
      answer = await asker(db, personCode, item.question, now);
    } catch {
      return { status: "error" };
    }

    if (!answer.matched || answerIsSystemError(answer)) return { status: "error" };
    if (answer.denied) {
      if (item.teamOnly) continue;
      return { status: "error" };
    }
    if (!answerHasReportableData(answer)) continue;
    sections.push(`• ${item.label}\n${stripAnswerVoice(answer.text)}`);
  }

  if (sections.length === 0) return { status: "empty" };
  const roundText = round.round === "morning" ? "เช้า 08:00" : "เย็น 17:00";
  const delayedText = round.delayed ? "ย้อนหลัง" : "";
  const heading = `น้องกุ้งสรุป${delayedText}รอบ${roundText} ประจำวันที่ ${round.date}`;
  return {
    status: "ready",
    text: `${heading}\n\n${sections.join("\n\n")}\n\nจบสรุปรอบนี้ค่ะ`,
  };
}

export async function processScheduledSummaries(
  env: Env,
  now: string,
  fetcher: Fetcher = fetch,
  asker: SummaryAsker = askQuestion,
): Promise<SummaryRunResult> {
  const result: SummaryRunResult = {
    sent: 0,
    empty: 0,
    retried: 0,
    dead: 0,
    missed: 0,
    configMissing: 0,
    skippedHoliday: 0,
    checkpointSafe: true,
  };
  const latestCron = await readLatestCronBefore(env.DB, now);
  const [people, selection] = await Promise.all([
    readLinkedPersonCodes(env.DB),
    Promise.resolve(summaryRoundsToProcess(now, latestCron)),
  ]);
  const { rounds, skipped } = selection;
  if (skipped > 0) {
    await recordSummaryCatchupSkip(env.DB, skipped, now);
  }
  if (people.length > 0 && (!env.AIM_NOTIFY_URL || !env.AIM_NOTIFY_KEY)) {
    result.configMissing = people.length * rounds.length;
    result.checkpointSafe = false;
    for (const round of rounds) {
      await recordSummaryPassIssue(
        env.DB,
        summaryReference(round),
        "config_missing",
        now,
      );
    }
    return result;
  }
  const nowMilliseconds = requiredTimestamp(now);

  for (const round of rounds) {
    const age = nowMilliseconds - requiredTimestamp(round.scheduledAt);
    const referenceId = summaryReference(round);
    for (const personCode of people) {
      let claim: Awaited<ReturnType<typeof claimSummaryDelivery>> = null;
      try {
        if (age > maximumLatenessMilliseconds) {
          if (await recordSummaryTerminal(env.DB, referenceId, personCode, "missed", now)) {
            result.missed += 1;
          }
          continue;
        }

        claim = await claimSummaryDelivery(env.DB, referenceId, personCode, now);
        if (!claim) continue;

        const summary = await buildSummary(env.DB, personCode, round, now, asker);
        if (summary.status === "empty") {
          await finishSummaryDelivery(env.DB, claim.ledgerId, "empty");
          result.empty += 1;
          continue;
        }
        if (summary.status === "error") {
          await recordDeliveryFailure(
            env.DB,
            claim.ledgerId,
            claim.attempt,
            "summary_error",
            true,
          );
          if (claim.attempt > maximumRetryAttempts) result.dead += 1;
          else {
            result.retried += 1;
            result.checkpointSafe = false;
          }
          continue;
        }

        const outbound = await sendTextNotification(
          env,
          personCode,
          summary.text,
          `${referenceId}:${personCode}`,
          fetcher,
        );
        if (outbound.ok) {
          await finishSummaryDelivery(env.DB, claim.ledgerId, "sent");
          result.sent += 1;
        } else if (outbound.skipped) {
          // ฝั่งรับตั้งใจไม่ส่งเพราะวันหยุดของผู้รับ — ปิดรอบนี้ให้จบ ไม่ใช่ปล่อยค้างหรือจดว่าตาย
          // checkpoint เดินหน้าได้ตามปกติ เพราะงานรอบนี้ "จบแล้ว" จริง ๆ ไม่มีอะไรค้างให้ตามเก็บ
          await finishSummaryDelivery(env.DB, claim.ledgerId, "skipped_holiday");
          result.skippedHoliday += 1;
        } else {
          const dead = await recordDeliveryFailure(
            env.DB,
            claim.ledgerId,
            claim.attempt,
            safeOutcomeReason(outbound.reason),
            outbound.retryable,
          );
          if (dead) result.dead += 1;
          else {
            result.retried += 1;
            result.checkpointSafe = false;
          }
        }
      } catch {
        result.retried += 1;
        result.checkpointSafe = false;
        try {
          if (claim) {
            await finishSummaryDelivery(env.DB, claim.ledgerId, "retry:person_error");
          } else {
            await recordSummaryPersonIssue(env.DB, referenceId, personCode, now);
          }
        } catch {
          await recordSummaryPersonIssue(env.DB, referenceId, personCode, now);
        }
      }
    }
  }

  return result;
}

async function recordDeliveryFailure(
  db: D1Database,
  ledgerId: number,
  attempt: number,
  reason: string,
  retryable: boolean,
): Promise<boolean> {
  const outcome =
    !retryable || attempt > maximumRetryAttempts
      ? (`dead:${reason}` as const)
      : (`retry:${reason}` as const);
  await finishSummaryDelivery(db, ledgerId, outcome);
  return outcome.startsWith("dead:");
}

function latestScheduledRound(now: string): ScheduledSummaryRound {
  const nowMilliseconds = requiredTimestamp(now);
  const dayStart = requiredTimestamp(thaiDayRange(now).startUtc);
  const morning = dayStart + 8 * 60 * 60_000;
  const evening = dayStart + 17 * 60 * 60_000;
  if (nowMilliseconds >= evening) return scheduledRound("evening", evening, nowMilliseconds);
  if (nowMilliseconds >= morning) return scheduledRound("morning", morning, nowMilliseconds);
  return scheduledRound("evening", dayStart - dayMilliseconds + 17 * 60 * 60_000, nowMilliseconds);
}

function scheduledRound(
  round: SummaryRound,
  scheduledMilliseconds: number,
  nowMilliseconds: number,
): ScheduledSummaryRound {
  const scheduledAt = new Date(scheduledMilliseconds).toISOString();
  const local = thaiLocalDate(scheduledAt);
  const date = [
    String(local.getUTCDate()).padStart(2, "0"),
    String(local.getUTCMonth() + 1).padStart(2, "0"),
    String(local.getUTCFullYear() + 543),
  ].join("/");
  return {
    round,
    date,
    scheduledAt,
    delayed: nowMilliseconds - scheduledMilliseconds >= 60_000,
  };
}

function summaryReference(round: ScheduledSummaryRound): string {
  return `${round.date}:${round.round}`;
}

function answerIsSystemError(answer: Answer): boolean {
  return (
    answer.text.includes("อ่านข้อมูลไม่ได้ในขณะนี้") ||
    answer.text.includes("ไม่พบข้อมูลผู้ใช้งาน")
  );
}

function answerHasReportableData(answer: Answer): boolean {
  if (answer.intent === "team_today") {
    return /[1-9]\d*\s+งาน/u.test(answer.text);
  }
  const emptyMarker = emptyAnswerMarkers[answer.intent];
  return emptyMarker === undefined || !answer.text.includes(emptyMarker);
}

function stripAnswerVoice(text: string): string {
  return text
    .replace(/^น้องกุ้ง/u, "")
    .trim()
    .replace(/(?:ค่ะ|คะ)\s*$/u, "")
    .trimEnd();
}

function safeOutcomeReason(reason: string): string {
  return /^[a-z0-9_]{1,32}$/.test(reason) ? reason : "unknown";
}

function requiredTimestamp(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new RangeError("Invalid UTC timestamp");
  return parsed;
}
