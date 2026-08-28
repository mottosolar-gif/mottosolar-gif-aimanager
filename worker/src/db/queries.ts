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
}

export interface AssignedTaskQueryRow extends TaskQueryRow {
  assigned_at: string;
}

export interface PersonTaskCountQueryRow {
  assignee_person_code: string | null;
  task_count: number;
}

export interface PersonDurationAggregateQueryRow extends PersonTaskCountQueryRow {
  total_milliseconds: number;
  invalid_task_count: number;
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
  t.completed_at
`;

const nonTerminalStatuses =
  "'draft','assigned','accepted','en_route','arrived','in_progress','blocked'";
const openStatuses =
  "'assigned','accepted','en_route','arrived','in_progress','blocked'";
export const candidateRowLimit = 500;
const candidateFetchLimit = candidateRowLimit + 1;

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
): Promise<TaskQueryRow[]> {
  return all<TaskQueryRow>(
    db,
    `SELECT ${taskColumns}
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
): Promise<TaskQueryRow[]> {
  return all<TaskQueryRow>(
    db,
    `SELECT ${taskColumns}
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
): Promise<TaskQueryRow[]> {
  return all<TaskQueryRow>(
    db,
    `SELECT ${taskColumns}
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
): Promise<TaskQueryRow[]> {
  return all<TaskQueryRow>(
    db,
    `SELECT ${taskColumns}
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
     GROUP BY t.task_ref, t.title, t.status, t.assignee_person_code,
              t.created_at, t.scheduled_at, t.due_at,
              t.accepted_at, t.completed_at
     ORDER BY assigned_at DESC, t.task_ref
     LIMIT 1`,
    actorPersonCode,
  );
}

export function queryTeamUnacceptedTasks(
  db: D1Database,
): Promise<AssignedTaskQueryRow[]> {
  return all<AssignedTaskQueryRow>(
    db,
    `SELECT ${taskColumns},
            COALESCE(MAX(te.occurred_at), t.created_at) AS assigned_at
     FROM task t
     LEFT JOIN task_event te
       ON te.task_ref = t.task_ref AND te.new_status = 'assigned'
     WHERE t.status = 'assigned'
       AND t.assignee_person_code IS NOT NULL
     GROUP BY t.task_ref, t.title, t.status, t.assignee_person_code,
              t.created_at, t.scheduled_at, t.due_at,
              t.accepted_at, t.completed_at
     ORDER BY assigned_at, t.task_ref
     LIMIT ${candidateFetchLimit}`,
  );
}

export function queryTeamOpenCandidates(
  db: D1Database,
): Promise<PersonTaskCountQueryRow[]> {
  return all<PersonTaskCountQueryRow>(
    db,
    `SELECT t.assignee_person_code, COUNT(*) AS task_count
     FROM task t
     WHERE t.status IN (${openStatuses})
       AND t.assignee_person_code IS NOT NULL
     GROUP BY t.assignee_person_code
     ORDER BY t.assignee_person_code`,
  );
}

export function queryTeamOverdueCandidates(
  db: D1Database,
  now: string,
): Promise<TaskQueryRow[]> {
  return all<TaskQueryRow>(
    db,
    `SELECT ${taskColumns}
     FROM task t
     WHERE t.due_at < ?
       AND t.status NOT IN ('completed','cancelled','rejected')
       AND t.assignee_person_code IS NOT NULL
     ORDER BY t.due_at, t.task_ref
     LIMIT ${candidateFetchLimit}`,
    now,
  );
}

export function queryTeamTodayCandidates(
  db: D1Database,
  startUtc: string,
  endUtc: string,
): Promise<TaskQueryRow[]> {
  return all<TaskQueryRow>(
    db,
     `SELECT ${taskColumns}
      FROM task t
      WHERE (
         (t.created_at >= ? AND t.created_at < ?)
         OR (t.completed_at >= ? AND t.completed_at < ?)
         OR t.status IN (${openStatuses})
       )
     ORDER BY t.created_at, t.task_ref
     LIMIT ${candidateFetchLimit}`,
    startUtc,
    endUtc,
    startUtc,
    endUtc,
  );
}

export function queryTeamRejectedCandidates(
  db: D1Database,
): Promise<TaskQueryRow[]> {
  return all<TaskQueryRow>(
    db,
    `SELECT ${taskColumns}
     FROM task t
     WHERE t.status = 'rejected'
       AND t.assignee_person_code IS NOT NULL
     ORDER BY t.assignee_person_code, t.updated_at, t.task_ref
     LIMIT ${candidateFetchLimit}`,
  );
}

export function queryTeamUnassignedTasks(db: D1Database): Promise<TaskQueryRow[]> {
  return all<TaskQueryRow>(
    db,
    `SELECT ${taskColumns}
     FROM task t
     WHERE t.assignee_person_code IS NULL
       AND t.status IN (${nonTerminalStatuses})
     ORDER BY t.due_at IS NULL, t.due_at, t.created_at, t.task_ref
     LIMIT ${candidateFetchLimit}`,
  );
}

export function queryCompletedMonthCandidates(
  db: D1Database,
  startUtc: string,
  endUtc: string,
): Promise<PersonTaskCountQueryRow[]> {
  return all<PersonTaskCountQueryRow>(
    db,
    `SELECT t.assignee_person_code, COUNT(*) AS task_count
     FROM task t
     WHERE t.status = 'completed'
       AND t.completed_at >= ?
       AND t.completed_at < ?
       AND t.assignee_person_code IS NOT NULL
     GROUP BY t.assignee_person_code
     ORDER BY t.assignee_person_code`,
    startUtc,
    endUtc,
  );
}

export function queryRejectedMonthCandidates(
  db: D1Database,
  startUtc: string,
  endUtc: string,
): Promise<PersonTaskCountQueryRow[]> {
  return all<PersonTaskCountQueryRow>(
    db,
    `SELECT t.assignee_person_code, COUNT(*) AS task_count
     FROM task t
     WHERE t.assignee_person_code IS NOT NULL
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
    startUtc,
    endUtc,
  );
}

export function queryCycleTimeCandidates(
  db: D1Database,
  startUtc: string,
  endUtc: string,
): Promise<PersonDurationAggregateQueryRow[]> {
  return all<PersonDurationAggregateQueryRow>(
    db,
    `SELECT t.assignee_person_code,
            COUNT(*) AS task_count,
            CAST(ROUND(COALESCE(SUM(
              (julianday(t.completed_at) - julianday(t.accepted_at)) * 86400000.0
            ), 0)) AS INTEGER) AS total_milliseconds,
            SUM(CASE
              WHEN julianday(t.completed_at) IS NULL
                OR julianday(t.accepted_at) IS NULL THEN 1
              ELSE 0
            END) AS invalid_task_count
     FROM task t
     WHERE t.status = 'completed'
       AND t.completed_at >= ?
       AND t.completed_at < ?
       AND t.accepted_at IS NOT NULL
       AND t.completed_at >= t.accepted_at
       AND t.assignee_person_code IS NOT NULL
     GROUP BY t.assignee_person_code
     ORDER BY t.assignee_person_code`,
    startUtc,
    endUtc,
  );
}

export function queryAcceptTimeCandidates(
  db: D1Database,
): Promise<PersonDurationAggregateQueryRow[]> {
  return all<PersonDurationAggregateQueryRow>(
    db,
    `SELECT t.assignee_person_code,
            COUNT(*) AS task_count,
            CAST(ROUND(COALESCE(SUM(
              (julianday(t.accepted_at) - julianday(t.created_at)) * 86400000.0
            ), 0)) AS INTEGER) AS total_milliseconds,
            SUM(CASE
              WHEN julianday(t.accepted_at) IS NULL
                OR julianday(t.created_at) IS NULL THEN 1
              ELSE 0
            END) AS invalid_task_count
     FROM task t
     WHERE t.accepted_at IS NOT NULL
       AND t.accepted_at >= t.created_at
       AND t.assignee_person_code IS NOT NULL
     GROUP BY t.assignee_person_code
     ORDER BY t.assignee_person_code`,
  );
}

export function queryNewTodayCandidates(
  db: D1Database,
  startUtc: string,
  endUtc: string,
): Promise<PersonTaskCountQueryRow[]> {
  return all<PersonTaskCountQueryRow>(
    db,
    `SELECT t.assignee_person_code, COUNT(*) AS task_count
      FROM task t
      WHERE t.created_at >= ?
        AND t.created_at < ?
      GROUP BY t.assignee_person_code
      ORDER BY t.assignee_person_code`,
    startUtc,
    endUtc,
  );
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
