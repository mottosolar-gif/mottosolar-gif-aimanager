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
  // ★ 2026-08-28 (D-P0-17): งานที่ขึ้นต้น "L-" เป็น **สำเนา** ของ db_customs.tbl_task ฝั่ง LIVE
  // ความจริงอยู่ที่โน่น ⇒ เขียนที่นี่จะถูก ksk-aim-task-sync ทับกลับภายใน 10 นาที
  // = ผู้ใช้กดปุ่มแล้วเห็นว่าสำเร็จ แล้วมันหายไป ซึ่งแย่กว่าไม่มีปุ่ม
  // ปุ่มบนการ์ดถูกเปลี่ยนให้ยิงเข้า ll_task_postback() ฝั่ง LIVE แล้ว (lib/aim_notify.php)
  // ด่านนี้เป็นชั้นที่สอง เผื่อการ์ดเก่าที่ส่งไปแล้วยังมีปุ่ม aim_* ค้างอยู่ในแชตของใครสักคน
  if (taskRef.startsWith("L-")) {
    throw new Error("mirrored task is read-only here: " + taskRef);
  }

  const current = await readTaskByRef(db, taskRef);
  if (!current) throw new Error("task not found: " + taskRef);

  if (source === "line" && current.assigneePersonCode !== actorPersonCode) {
    throw new Error(
      `actor not authorized for task ${taskRef}: expected assignee '${current.assigneePersonCode ?? "none"}', got '${actorPersonCode ?? "none"}'`,
    );
  }

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
