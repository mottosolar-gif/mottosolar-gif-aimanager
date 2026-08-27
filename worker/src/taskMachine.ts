import {
  applyTaskTransition,
  readTaskByRef,
} from "./db/repository.ts";

export const TASK_STATUSES = [
  "draft",
  "assigned",
  "accepted",
  "rejected",
  "en_route",
  "arrived",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
] as const;

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ["assigned"],
  assigned: ["accepted", "rejected"],
  accepted: ["en_route", "cancelled"],
  en_route: ["arrived"],
  arrived: ["in_progress"],
  in_progress: ["completed", "blocked"],
  blocked: ["in_progress", "cancelled"],
  rejected: [],
  completed: [],
  cancelled: [],
};

export function isValidTransition(from: string, to: string): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface TaskRow {
  id: number;
  taskRef: string;
  title: string;
  description: string | null;
  status: string;
  assigneePersonCode: string | null;
  creatorPersonCode: string | null;
  priority: string;
  scheduledAt: string | null;
  dueAt: string | null;
  locationText: string | null;
  locationLat: number | null;
  locationLng: number | null;
  acceptedAt: string | null;
  startedAt: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  completionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

const NON_OVERDUE_STATUSES = new Set(["completed", "cancelled", "rejected"]);

export function deriveOverdue(task: TaskRow, now: string): boolean {
  return (
    task.dueAt !== null &&
    task.dueAt < now &&
    !NON_OVERDUE_STATUSES.has(task.status)
  );
}

export async function applyTransition(
  db: D1Database,
  taskRef: string,
  toStatus: string,
  actorPersonCode: string | null,
  source: string,
  note: string | null,
  now: string,
): Promise<TaskRow> {
  const current = await readTaskByRef(db, taskRef);
  if (!current) throw new Error("task not found: " + taskRef);
  if (!isValidTransition(current.status, toStatus)) {
    throw new Error(
      `invalid transition: cannot go from '${current.status}' to '${toStatus}'`,
    );
  }
  return applyTaskTransition(
    db,
    current,
    toStatus,
    actorPersonCode,
    source,
    note,
    now,
  );
}
