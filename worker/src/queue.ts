import {
  claimPendingJob,
  completeJob,
  killJob,
  readPendingJobs,
  recordCronTick,
  retryJob,
} from "./db/repository.ts";
import type { PendingJob } from "./db/repository.ts";

export const MAX_JOBS_PER_TICK = 10;

export interface ProcessQueueResult {
  processed: number;
  retried: number;
  dead: number;
}

export async function processQueue(
  db: D1Database,
  now: string,
): Promise<ProcessQueueResult> {
  const result: ProcessQueueResult = { processed: 0, retried: 0, dead: 0 };
  let jobs: PendingJob[] = [];
  try {
    jobs = await readPendingJobs(db, now, MAX_JOBS_PER_TICK);
  } catch {
    // D1 ไม่ตอบสนองตอนอ่านคิว — ปล่อยให้รอบนี้ไม่มีงาน แล้วยังคงบันทึก cron_tick ด้านล่างเสมอ
    jobs = [];
  }

  for (const job of jobs) {
    try {
      if (!(await claimPendingJob(db, job.id))) continue; // อีก tick claim ไปแล้ว ข้าม

      try {
        if (job.kind !== "line_event") {
          throw new Error(`unknown job kind: ${job.kind}`);
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

  await recordCronTick(db, result.processed, now);
  return result;
}
