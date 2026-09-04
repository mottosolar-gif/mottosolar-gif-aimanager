import {
  claimPendingJob,
  completeJob,
  findPersonCodeBySourceHash,
  killJob,
  readInboxPostback,
  readPendingJobs,
  recordCronTick,
  retryJob,
} from "./db/repository.ts";
import type { PendingJob } from "./db/repository.ts";
import { applyTransition } from "./taskMachine.ts";

export const MAX_JOBS_PER_TICK = 10;

const AIM_ACTION_TO_STATUS: Record<string, string> = {
  aim_accept: "accepted",
  aim_reject: "rejected",
  aim_enroute: "en_route",
  aim_arrived: "arrived",
  aim_start: "in_progress",
  aim_complete: "completed",
};

export interface ProcessQueueResult {
  processed: number;
  retried: number;
  dead: number;
}

export async function processQueue(
  db: D1Database,
  now: string,
  recordCheckpoint = true,
): Promise<ProcessQueueResult> {
  const result: ProcessQueueResult = { processed: 0, retried: 0, dead: 0 };
  // อ่านคิวพังต้องโยนออกไป — ห้ามบันทึก cron_tick ว่า ok ทั้งที่ไม่ได้ไล่งาน
  const jobs = await readPendingJobs(db, now, MAX_JOBS_PER_TICK);

  for (const job of jobs) {
    try {
      if (!(await claimPendingJob(db, job.id))) continue; // อีก tick claim ไปแล้ว ข้าม

      try {
        if (job.kind !== "line_event") {
          throw new Error(`unknown job kind: ${job.kind}`);
        }
        const inboxPostback = await readInboxPostback(db, job.eventId);
        if (inboxPostback?.postbackData !== null && inboxPostback?.postbackData !== undefined) {
          const params = new URLSearchParams(inboxPostback.postbackData);
          const action = params.get("act");
          if (action !== null && Object.hasOwn(AIM_ACTION_TO_STATUS, action)) {
            const personCode =
              inboxPostback.sourceHash === null
                ? null
                : await findPersonCodeBySourceHash(db, inboxPostback.sourceHash);
            if (personCode === null) {
              throw new Error(
                "unlinked person for postback: " + inboxPostback.sourceHash,
              );
            }
            await applyTransition(
              db,
              params.get("task") ?? "",
              AIM_ACTION_TO_STATUS[action],
              personCode,
              "line",
              null,
              now,
            );
          }
        }
        await completeJob(db, job.id, job.eventId, now);
        result.processed += 1;
      } catch (workError) {
        // ครอบคลุมทั้ง "kind แปลกปลอม" และ "completeJob เขียนล้มเหลว" ด้วยเส้นทางเดียวกัน
        // เพราะทั้งสองกรณีคือ "งานนี้ถูก claim แล้วแต่ยังไม่จบ" ต้อง resolve กลับเสมอ ห้ามปล่อยค้าง
        const errorMessage =
          workError instanceof Error ? workError.message : "unknown job processing error";
        const newAttempts = job.attempts + 1;
        if (newAttempts >= 5) {
          await killJob(db, job.id, job.eventId, newAttempts, errorMessage, now);
          result.dead += 1;
        } else {
          const delaySeconds = 30 * 2 ** (newAttempts - 1);
          const nextRunAt = new Date(Date.parse(now) + delaySeconds * 1000).toISOString();
          await retryJob(db, job.id, job.eventId, newAttempts, nextRunAt, errorMessage, now);
          result.retried += 1;
        }
      }
    } catch {
      // การ claim หรือการ resolve งานนี้ล้มเหลวแบบกู้คืนในรอบนี้ไม่ได้ (เช่น D1 ล้มแม้แต่ตอนเขียน
      // retry/kill) — ข้ามงานนี้ไปก่อน ไม่ปล่อยให้ 1 งานที่พังทำให้ทั้งชุด/ทั้ง tick ล้มตาม
      // (ความรู้ที่ต้องบันทึกไว้: ถ้าเกิดกรณีนี้ซ้อนกับ completeJob พังด้วย งานจะยังค้างที่
      // 'processing' ในรอบนี้ — ยอมรับเป็นข้อจำกัดที่รู้แล้วของ P0 รอ reclaim sweep ในเฟสถัดไป)
      continue;
    }
  }

  if (recordCheckpoint) {
    await recordCronTick(db, result.processed, now);
  }
  return result;
}
