import {
  claimPendingJob,
  completeJob,
  killJob,
  readPendingJobs,
  recordCronTick,
  retryJob,
} from "./db/repository.ts";

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
  const jobs = await readPendingJobs(db, now);

  for (const job of jobs.slice(0, MAX_JOBS_PER_TICK)) {
    if (!(await claimPendingJob(db, job.id))) continue;

    try {
      if (job.kind !== "line_event") {
        throw new Error(`unknown job kind: ${job.kind}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "unknown job processing error";
      const newAttempts = job.attempts + 1;
      if (newAttempts >= 5) {
        await killJob(db, job.id, job.eventId, newAttempts, errorMessage, now);
        result.dead += 1;
      } else {
        const delaySeconds = Math.min(30 * 2 ** (newAttempts - 1), 900);
        const nextRunAt = new Date(
          Date.parse(now) + delaySeconds * 1000,
        ).toISOString();
        await retryJob(
          db,
          job.id,
          job.eventId,
          newAttempts,
          nextRunAt,
          errorMessage,
          now,
        );
        result.retried += 1;
      }
      continue;
    }

    await completeJob(db, job.id, job.eventId, now);
    result.processed += 1;
  }

  await recordCronTick(db, result.processed, now);
  return result;
}
