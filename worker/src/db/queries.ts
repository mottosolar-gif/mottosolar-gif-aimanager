export interface TaskQueryRow {
  task_ref: string;
  title: string;
  status: string;
  assignee_person_code: string | null;
  created_at: string;
  scheduled_at: string | null;
  due_at: string | null;
  accepted_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

export interface AssignedTaskQueryRow extends TaskQueryRow {
  assigned_at: string;
}

export interface CountedTaskQueryRow extends TaskQueryRow {
  total_count: number;
}

export interface CountedAssignedTaskQueryRow extends AssignedTaskQueryRow {
  total_count: number;
}

export interface PersonTaskCountQueryRow {
  assignee_person_code: string | null;
  task_count: number;
}

export interface PersonDurationAggregateQueryRow extends PersonTaskCountQueryRow {
  total_milliseconds: number;
  invalid_task_count: number;
}

export interface TeamTodayCountQueryRow {
  new_count: number;
  completed_count: number;
  assigned_open_count: number;
  unassigned_open_count: number;
}

export interface SystemStatusQueryResult {
  latestInboxAt: string | null;
  pendingJobs: number;
  latestCronAt: string | null;
  latestCronOutcome: string | null;
}

const taskColumns = `
  t.task_ref,
  t.title,
  t.status,
  t.assignee_person_code,
  t.created_at,
  t.scheduled_at,
  t.due_at,
  t.accepted_at,
  t.completed_at,
  t.updated_at
`;

const countedTaskColumns = `${taskColumns}, COUNT(*) OVER () AS total_count`;

const nonTerminalStatuses =
  "'draft','assigned','accepted','en_route','arrived','in_progress','blocked'";
const openStatuses =
  "'assigned','accepted','en_route','arrived','in_progress','blocked'";
export const candidateRowLimit = 500;
const candidateFetchLimit = candidateRowLimit + 1;
// D1 rejects statements near 100 bound values. Keep room for time ranges and
// future fixed predicates instead of spending the whole allowance on people.
const visiblePersonCodeChunkSize = 80;

function personCodeScope(personCodes: readonly string[]): {
  placeholders: string;
  bindings: string[];
} {
  if (personCodes.length === 0) {
    throw new RangeError("At least one visible person code is required");
  }
  return {
    placeholders: personCodes.map(() => "?").join(", "),
    bindings: [...personCodes],
  };
}

function personCodeScopes(personCodes: readonly string[]): Array<{
  placeholders: string;
  bindings: string[];
}> {
  if (personCodes.length === 0) {
    throw new RangeError("At least one visible person code is required");
  }
  const scopes = [];
  for (let index = 0; index < personCodes.length; index += visiblePersonCodeChunkSize) {
    scopes.push(personCodeScope(personCodes.slice(index, index + visiblePersonCodeChunkSize)));
  }
  return scopes;
}

function mergeCountedCandidates<T extends { total_count: number }>(
  chunks: T[][],
  compare: (left: T, right: T) => number,
): T[] {
  const totalCount = chunks.reduce(
    (total, rows) => total + Number(rows[0]?.total_count ?? 0),
    0,
  );
  return chunks
    .flat()
    .sort(compare)
    .slice(0, candidateFetchLimit)
    .map((row) => ({ ...row, total_count: totalCount }));
}

async function all<T>(
  db: D1Database,
  sql: string,
  ...bindings: unknown[]
): Promise<T[]> {
  const statement = db.prepare(sql);
  const result = await (bindings.length > 0 ? statement.bind(...bindings) : statement).all<T>();
  return result.results;
}

export function queryMyTasks(
  db: D1Database,
  actorPersonCode: string,
): Promise<CountedTaskQueryRow[]> {
  return all<CountedTaskQueryRow>(
    db,
    `SELECT ${countedTaskColumns}
     FROM task t
     WHERE t.assignee_person_code = ?
       AND t.status IN (${nonTerminalStatuses})
     ORDER BY t.due_at IS NULL, t.due_at, t.scheduled_at IS NULL,
              t.scheduled_at, t.created_at, t.task_ref`,
    actorPersonCode,
  );
}

export function queryMyOpenTasks(
  db: D1Database,
  actorPersonCode: string,
): Promise<CountedTaskQueryRow[]> {
  return all<CountedTaskQueryRow>(
    db,
    `SELECT ${countedTaskColumns}
     FROM task t
     WHERE t.assignee_person_code = ?
       AND t.status IN (${openStatuses})
     ORDER BY t.due_at IS NULL, t.due_at, t.created_at, t.task_ref`,
    actorPersonCode,
  );
}

export function queryMyOverdueTasks(
  db: D1Database,
  actorPersonCode: string,
  now: string,
): Promise<CountedTaskQueryRow[]> {
  return all<CountedTaskQueryRow>(
    db,
    `SELECT ${countedTaskColumns}
     FROM task t
     WHERE t.assignee_person_code = ?
       AND t.due_at < ?
       AND t.status NOT IN ('completed','cancelled','rejected')
     ORDER BY t.due_at, t.task_ref`,
    actorPersonCode,
    now,
  );
}

export function queryMyCompletedTasks(
  db: D1Database,
  actorPersonCode: string,
  startUtc: string,
  endUtc: string,
): Promise<CountedTaskQueryRow[]> {
  return all<CountedTaskQueryRow>(
    db,
    `SELECT ${countedTaskColumns}
     FROM task t
     WHERE t.assignee_person_code = ?
       AND t.status = 'completed'
       AND t.completed_at >= ?
       AND t.completed_at < ?
     ORDER BY t.completed_at, t.task_ref`,
    actorPersonCode,
    startUtc,
    endUtc,
  );
}

export function queryMyNextTask(
  db: D1Database,
  actorPersonCode: string,
): Promise<TaskQueryRow[]> {
  return all<TaskQueryRow>(
    db,
    `SELECT ${taskColumns}
     FROM task t
     WHERE t.assignee_person_code = ?
       AND t.status IN (${nonTerminalStatuses})
     ORDER BY t.due_at IS NULL, t.due_at,
              t.scheduled_at IS NULL, t.scheduled_at,
              t.created_at, t.task_ref
     LIMIT 1`,
    actorPersonCode,
  );
}

export function queryMyLatestAssignedTask(
  db: D1Database,
  actorPersonCode: string,
): Promise<AssignedTaskQueryRow[]> {
  return all<AssignedTaskQueryRow>(
    db,
    `SELECT ${taskColumns}, MAX(te.occurred_at) AS assigned_at
     FROM task t
     JOIN task_event te ON te.task_ref = t.task_ref
     WHERE t.assignee_person_code = ?
       AND te.new_status = 'assigned'
       -- "งานล่าสุดที่ได้รับมอบหมาย" ต้องเป็นงานที่ยังต้องทำ: งานที่ถูกยกเลิกไปแล้ว
       -- ไม่ใช่งานที่มอบหมายให้พี่อยู่ ⇒ ตัดออก (D-P0-21 หนี้ข้อ 2)
       AND t.status <> 'cancelled'
     GROUP BY t.task_ref, t.title, t.status, t.assignee_person_code,
              t.created_at, t.scheduled_at, t.due_at,
              t.accepted_at, t.completed_at
     ORDER BY assigned_at DESC, t.task_ref
     LIMIT 1`,
    actorPersonCode,
  );
}

export async function queryTeamUnacceptedTasks(
  db: D1Database,
  visiblePersonCodes: readonly string[],
): Promise<CountedAssignedTaskQueryRow[]> {
  const chunks = await Promise.all(
    personCodeScopes(visiblePersonCodes).map((scope) =>
      all<CountedAssignedTaskQueryRow>(
        db,
        `SELECT ${taskColumns},
                COALESCE(MAX(te.occurred_at), t.created_at) AS assigned_at,
                COUNT(*) OVER () AS total_count
         FROM task t
         LEFT JOIN task_event te
           ON te.task_ref = t.task_ref AND te.new_status = 'assigned'
         WHERE t.status = 'assigned'
           AND t.assignee_person_code IN (${scope.placeholders})
         GROUP BY t.task_ref, t.title, t.status, t.assignee_person_code,
                  t.created_at, t.scheduled_at, t.due_at,
                  t.accepted_at, t.completed_at, t.updated_at
         ORDER BY assigned_at, t.task_ref
         LIMIT ${candidateFetchLimit}`,
        ...scope.bindings,
      ),
    ),
  );
  return mergeCountedCandidates(
    chunks,
    (left, right) =>
      left.assigned_at.localeCompare(right.assigned_at) ||
      left.task_ref.localeCompare(right.task_ref),
  );
}

export async function queryTeamOpenCandidates(
  db: D1Database,
  visiblePersonCodes: readonly string[],
): Promise<PersonTaskCountQueryRow[]> {
  const chunks = await Promise.all(
    personCodeScopes(visiblePersonCodes).map((scope) =>
      all<PersonTaskCountQueryRow>(
        db,
        `SELECT t.assignee_person_code, COUNT(*) AS task_count
         FROM task t
         WHERE t.status IN (${openStatuses})
           AND t.assignee_person_code IN (${scope.placeholders})
         GROUP BY t.assignee_person_code
         ORDER BY t.assignee_person_code`,
        ...scope.bindings,
      ),
    ),
  );
  return chunks.flat();
}

export async function queryTeamOverdueCandidates(
  db: D1Database,
  now: string,
  visiblePersonCodes: readonly string[],
): Promise<CountedTaskQueryRow[]> {
  const chunks = await Promise.all(
    personCodeScopes(visiblePersonCodes).map((scope) =>
      all<CountedTaskQueryRow>(
        db,
        `SELECT ${countedTaskColumns}
         FROM task t
         WHERE t.due_at < ?
           AND t.status NOT IN ('completed','cancelled','rejected')
           AND t.assignee_person_code IN (${scope.placeholders})
         ORDER BY t.due_at, t.task_ref
         LIMIT ${candidateFetchLimit}`,
        now,
        ...scope.bindings,
      ),
    ),
  );
  return mergeCountedCandidates(
    chunks,
    (left, right) =>
      (left.due_at ?? "").localeCompare(right.due_at ?? "") ||
      left.task_ref.localeCompare(right.task_ref),
  );
}

export async function queryTeamTodayCounts(
  db: D1Database,
  startUtc: string,
  endUtc: string,
  visiblePersonCodes: readonly string[],
  includeUnassigned: boolean,
): Promise<TeamTodayCountQueryRow> {
  const rows = await Promise.all(
    personCodeScopes(visiblePersonCodes).map((scope, index) => {
      const unassignedScope = includeUnassigned && index === 0
        ? " OR t.assignee_person_code IS NULL"
        : "";
      return all<TeamTodayCountQueryRow>(
        db,
        `SELECT
           -- "งานใหม่วันนี้" = งานที่เข้ามาแล้วยังมีอยู่จริง ⇒ ใบที่ถูกยกเลิกแล้วไม่นับ (D-P0-21 หนี้ข้อ 2)
           SUM(CASE WHEN t.created_at >= ? AND t.created_at < ?
                      AND t.status <> 'cancelled' THEN 1 ELSE 0 END) AS new_count,
           -- "งานเสร็จวันนี้" ต้องเป็นงานที่เสร็จแล้วยังนับเป็นงานเสร็จจริง ⇒ ใบที่ภายหลังถูก
           -- ยกเลิก (LIVE ส่ง completed_at/status แยกกันผ่าน POST /sync/tasks) ไม่นับ (D-P0-21 หนี้ข้อ 2)
           SUM(CASE WHEN t.completed_at >= ? AND t.completed_at < ?
                      AND t.status <> 'cancelled' THEN 1 ELSE 0 END) AS completed_count,
           SUM(CASE
             WHEN t.assignee_person_code IS NOT NULL
               AND t.status IN (${openStatuses}) THEN 1 ELSE 0
           END) AS assigned_open_count,
           SUM(CASE
             WHEN t.assignee_person_code IS NULL
               AND t.status IN (${openStatuses}) THEN 1 ELSE 0
           END) AS unassigned_open_count
         FROM task t
         WHERE (t.assignee_person_code IN (${scope.placeholders})${unassignedScope})`,
        startUtc,
        endUtc,
        startUtc,
        endUtc,
        ...scope.bindings,
      );
    }),
  );
  return rows.flat().reduce<TeamTodayCountQueryRow>(
    (total, row) => ({
      new_count: total.new_count + Number(row.new_count ?? 0),
      completed_count: total.completed_count + Number(row.completed_count ?? 0),
      assigned_open_count:
        total.assigned_open_count + Number(row.assigned_open_count ?? 0),
      unassigned_open_count:
        total.unassigned_open_count + Number(row.unassigned_open_count ?? 0),
    }),
    {
      new_count: 0,
      completed_count: 0,
      assigned_open_count: 0,
      unassigned_open_count: 0,
    },
  );
}

export async function queryTeamRejectedCandidates(
  db: D1Database,
  visiblePersonCodes: readonly string[],
): Promise<CountedTaskQueryRow[]> {
  const chunks = await Promise.all(
    personCodeScopes(visiblePersonCodes).map((scope) =>
      all<CountedTaskQueryRow>(
        db,
        `SELECT ${countedTaskColumns}
         FROM task t
         WHERE t.status = 'rejected'
           AND t.assignee_person_code IN (${scope.placeholders})
         ORDER BY t.assignee_person_code, t.updated_at, t.task_ref
         LIMIT ${candidateFetchLimit}`,
        ...scope.bindings,
      ),
    ),
  );
  return mergeCountedCandidates(
    chunks,
    (left, right) =>
      (left.assignee_person_code ?? "").localeCompare(
        right.assignee_person_code ?? "",
      ) ||
      left.updated_at.localeCompare(right.updated_at) ||
      left.task_ref.localeCompare(right.task_ref),
  );
}

export function queryTeamUnassignedTasks(
  db: D1Database,
): Promise<CountedTaskQueryRow[]> {
  return all<CountedTaskQueryRow>(
    db,
    `SELECT ${countedTaskColumns}
     FROM task t
     WHERE t.assignee_person_code IS NULL
       AND t.status IN (${nonTerminalStatuses})
     ORDER BY t.due_at IS NULL, t.due_at, t.created_at, t.task_ref
     LIMIT ${candidateFetchLimit}`,
  );
}

export async function queryCompletedMonthCandidates(
  db: D1Database,
  startUtc: string,
  endUtc: string,
  visiblePersonCodes: readonly string[],
): Promise<PersonTaskCountQueryRow[]> {
  const chunks = await Promise.all(
    personCodeScopes(visiblePersonCodes).map((scope) =>
      all<PersonTaskCountQueryRow>(
        db,
        `SELECT t.assignee_person_code, COUNT(*) AS task_count
         FROM task t
         WHERE t.status = 'completed'
           AND t.completed_at >= ?
           AND t.completed_at < ?
           AND t.assignee_person_code IN (${scope.placeholders})
         GROUP BY t.assignee_person_code
         ORDER BY t.assignee_person_code`,
        startUtc,
        endUtc,
        ...scope.bindings,
      ),
    ),
  );
  return chunks.flat();
}

export async function queryRejectedMonthCandidates(
  db: D1Database,
  startUtc: string,
  endUtc: string,
  visiblePersonCodes: readonly string[],
): Promise<PersonTaskCountQueryRow[]> {
  const chunks = await Promise.all(
    personCodeScopes(visiblePersonCodes).map((scope) =>
      all<PersonTaskCountQueryRow>(
        db,
        `SELECT t.assignee_person_code, COUNT(*) AS task_count
         FROM task t
         WHERE t.assignee_person_code IN (${scope.placeholders})
           -- นับ "งานที่ถูกปฏิเสธเดือนนี้" จากเหตุการณ์ปฏิเสธจริง แต่ใบที่ถูกยกเลิกไปแล้ว
           -- ไม่ควรพองสถิติการปฏิเสธ (เจตนาของคำถามคือปฏิเสธ ไม่ใช่ยกเลิก · D-P0-21 หนี้ข้อ 2)
           AND t.status <> 'cancelled'
           AND EXISTS (
             SELECT 1
             FROM task_event te
             WHERE te.task_ref = t.task_ref
               AND te.new_status = 'rejected'
               AND te.occurred_at >= ?
               AND te.occurred_at < ?
           )
         GROUP BY t.assignee_person_code
         ORDER BY t.assignee_person_code`,
        ...scope.bindings,
        startUtc,
        endUtc,
      ),
    ),
  );
  return chunks.flat();
}

export async function queryCycleTimeCandidates(
  db: D1Database,
  startUtc: string,
  endUtc: string,
  visiblePersonCodes: readonly string[],
): Promise<PersonDurationAggregateQueryRow[]> {
  const chunks = await Promise.all(
    personCodeScopes(visiblePersonCodes).map((scope) =>
      all<PersonDurationAggregateQueryRow>(
        db,
        `SELECT t.assignee_person_code,
            SUM(CASE
              WHEN julianday(t.completed_at) IS NOT NULL
                AND julianday(t.accepted_at) IS NOT NULL
                AND julianday(t.completed_at) >= julianday(t.accepted_at) THEN 1
              ELSE 0
            END) AS task_count,
            CAST(ROUND(COALESCE(SUM(
              CASE
                WHEN julianday(t.completed_at) IS NOT NULL
                  AND julianday(t.accepted_at) IS NOT NULL
                  AND julianday(t.completed_at) >= julianday(t.accepted_at)
                THEN (julianday(t.completed_at) - julianday(t.accepted_at)) * 86400000.0
                ELSE 0
              END
            ), 0)) AS INTEGER) AS total_milliseconds,
            SUM(CASE
              WHEN julianday(t.completed_at) IS NULL
                OR julianday(t.accepted_at) IS NULL
                OR julianday(t.completed_at) < julianday(t.accepted_at) THEN 1
              ELSE 0
            END) AS invalid_task_count
         FROM task t
         WHERE t.status = 'completed'
           AND t.completed_at >= ?
           AND t.completed_at < ?
           AND t.assignee_person_code IN (${scope.placeholders})
         GROUP BY t.assignee_person_code
         ORDER BY t.assignee_person_code`,
        startUtc,
        endUtc,
        ...scope.bindings,
      ),
    ),
  );
  return chunks.flat();
}

export async function queryAcceptTimeCandidates(
  db: D1Database,
  startUtc: string,
  endUtc: string,
  visiblePersonCodes: readonly string[],
): Promise<PersonDurationAggregateQueryRow[]> {
  const chunks = await Promise.all(
    personCodeScopes(visiblePersonCodes).map((scope) =>
      all<PersonDurationAggregateQueryRow>(
        db,
        `SELECT t.assignee_person_code,
            SUM(CASE
              WHEN julianday(t.accepted_at) IS NOT NULL
                AND julianday(t.created_at) IS NOT NULL
                AND julianday(t.accepted_at) >= julianday(t.created_at) THEN 1
              ELSE 0
            END) AS task_count,
            CAST(ROUND(COALESCE(SUM(
              CASE
                WHEN julianday(t.accepted_at) IS NOT NULL
                  AND julianday(t.created_at) IS NOT NULL
                  AND julianday(t.accepted_at) >= julianday(t.created_at)
                THEN (julianday(t.accepted_at) - julianday(t.created_at)) * 86400000.0
                ELSE 0
              END
            ), 0)) AS INTEGER) AS total_milliseconds,
            SUM(CASE
              WHEN julianday(t.accepted_at) IS NULL
                OR julianday(t.created_at) IS NULL
                OR julianday(t.accepted_at) < julianday(t.created_at) THEN 1
              ELSE 0
            END) AS invalid_task_count
         FROM task t
         WHERE t.accepted_at IS NOT NULL
           AND t.accepted_at >= ?
           AND t.accepted_at < ?
           -- "ใครรับงานเร็วที่สุด" วัดจากงานที่รับแล้วยังเป็นงานอยู่จริง ⇒ ใบที่ถูกยกเลิกไม่เข้าอันดับ
           -- (D-P0-21 หนี้ข้อ 2 — วันที่ accepted_at เริ่มมีค่า ใบยกเลิกจะไหลเข้าสถิติทันที)
           AND t.status <> 'cancelled'
           AND t.assignee_person_code IN (${scope.placeholders})
         GROUP BY t.assignee_person_code
         ORDER BY t.assignee_person_code`,
        startUtc,
        endUtc,
        ...scope.bindings,
      ),
    ),
  );
  return chunks.flat();
}

export async function queryNewTodayCandidates(
  db: D1Database,
  startUtc: string,
  endUtc: string,
  visiblePersonCodes: readonly string[],
  includeUnassigned: boolean,
): Promise<PersonTaskCountQueryRow[]> {
  const chunks = await Promise.all(
    personCodeScopes(visiblePersonCodes).map((scope, index) => {
      const unassignedScope = includeUnassigned && index === 0
        ? " OR t.assignee_person_code IS NULL"
        : "";
      return all<PersonTaskCountQueryRow>(
        db,
        `SELECT t.assignee_person_code, COUNT(*) AS task_count
         FROM task t
         WHERE (t.assignee_person_code IN (${scope.placeholders})${unassignedScope})
           AND t.created_at >= ?
           AND t.created_at < ?
           -- คู่แฝดของ new_count ข้างบน: "วันนี้มีงานใหม่กี่ใบ" ต้องไม่นับใบที่ถูกยกเลิกแล้ว
           -- (แก้ที่ชนิดของบั๊ก ไม่ใช่เฉพาะจุดที่ถูกชี้ · D-P0-21 หนี้ข้อ 2 บรรทัด 584)
           AND t.status <> 'cancelled'
         GROUP BY t.assignee_person_code
         ORDER BY t.assignee_person_code`,
        ...scope.bindings,
        startUtc,
        endUtc,
      );
    }),
  );
  return chunks.flat();
}

export interface TimingDataPresence {
  acceptedTaskCount: number;
  cycleTaskCount: number;
}

interface TimingDataPresenceRow {
  accepted_task_count: number | null;
  cycle_task_count: number | null;
}

/**
 * มีข้อมูลเวลาให้คำนวณจริงหรือยัง — ถามทั้งฐาน ไม่ใช่แค่เดือนนี้/ขอบเขตของผู้ถาม
 * เพราะคำถามที่ต้องตอบคือ "ระบบยังไม่มีข้อมูลเวลาเลย" ไม่ใช่ "เดือนนี้ไม่มี"
 * (งานจริงเข้ามาทาง POST /sync/tasks ซึ่งไม่เขียน accepted_at และ applyTransition
 * ปฏิเสธ ref ที่ขึ้นต้น L- ⇒ task_event/accepted_at ว่างทั้งฐานมาตลอด)
 * คืนเป็นตัวนับระดับระบบล้วน ไม่มีคอลัมน์ที่ชี้ตัวคนหรือใบงาน ⇒ ไม่ใช่ช่องข้ามด่าน canView()
 * ห้ามเอาตัวเลขนี้ไปแสดงให้ผู้ใช้ ใช้ได้แค่เป็น "มี/ไม่มี"
 */
export async function queryTimingDataPresence(
  db: D1Database,
): Promise<TimingDataPresence> {
  const rows = await all<TimingDataPresenceRow>(
    db,
    `SELECT
       SUM(CASE
         WHEN t.accepted_at IS NOT NULL AND t.status <> 'cancelled' THEN 1 ELSE 0
       END) AS accepted_task_count,
       SUM(CASE
         WHEN t.accepted_at IS NOT NULL AND t.completed_at IS NOT NULL
           AND t.status <> 'cancelled' THEN 1 ELSE 0
       END) AS cycle_task_count
     FROM task t`,
  );
  const row = rows[0];
  return {
    acceptedTaskCount: Number(row?.accepted_task_count ?? 0),
    cycleTaskCount: Number(row?.cycle_task_count ?? 0),
  };
}

interface LatestInboxRow {
  latest_inbox_at: string | null;
}

interface PendingJobsRow {
  pending_jobs: number;
}

interface LatestCronRow {
  latest_cron_at: string;
  latest_cron_outcome: string;
}

export async function querySystemStatus(
  db: D1Database,
): Promise<SystemStatusQueryResult> {
  const statements = [
    db.prepare("SELECT MAX(received_at) AS latest_inbox_at FROM inbox_event"),
    db.prepare("SELECT COUNT(*) AS pending_jobs FROM job_queue WHERE status = 'pending'"),
    db.prepare(
      `SELECT occurred_at AS latest_cron_at, outcome AS latest_cron_outcome
       FROM ledger
       WHERE action_type = 'cron_tick'
       ORDER BY occurred_at DESC, id DESC
       LIMIT 1`,
    ),
  ];
  const [inboxResult, jobsResult, cronResult] = await db.batch(statements);
  const inbox = inboxResult.results[0] as unknown as LatestInboxRow | undefined;
  const jobs = jobsResult.results[0] as unknown as PendingJobsRow | undefined;
  const cron = cronResult.results[0] as unknown as LatestCronRow | undefined;
  return {
    latestInboxAt: inbox?.latest_inbox_at ?? null,
    pendingJobs: Number(jobs?.pending_jobs ?? 0),
    latestCronAt: cron?.latest_cron_at ?? null,
    latestCronOutcome: cron?.latest_cron_outcome ?? null,
  };
}
