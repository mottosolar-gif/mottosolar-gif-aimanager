export interface PersonRow {
  personCode: string;
  department: string;
  role: string;
}

interface PersonDatabaseRow {
  person_code: string;
  department: string;
  role: string;
}

export async function readPerson(
  db: D1Database,
  personCode: string,
): Promise<PersonRow | null> {
  const query = await db
    .prepare(
      "SELECT person_code, department, role FROM person WHERE person_code = ?",
    )
    .bind(personCode)
    .all<PersonDatabaseRow>();
  const row = query.results[0];
  return row
    ? {
        personCode: row.person_code,
        department: row.department,
        role: row.role,
      }
    : null;
}

export async function canView(
  db: D1Database,
  actorPersonCode: string,
  targetPersonCode: string,
): Promise<boolean> {
  const actor = await readPerson(db, actorPersonCode);
  // Unknown actors are denied, including when both input codes are identical.
  if (!actor) return false;

  if (actorPersonCode === targetPersonCode) return true;
  if (actor.role === "owner") return true;

  if (actor.role === "manager") {
    const target = await readPerson(db, targetPersonCode);
    // A manager cannot inherit visibility for a target absent from the database.
    if (!target) return false;
    // An empty department is a data-quality gap, never a basis for cross-visibility.
    if (actor.department === "" || target.department === "") return false;
    return actor.department === target.department;
  }

  // Workers and unknown roles are fail-closed for every other person.
  return false;
}

export function canAskTeamQuestion(actor: PersonRow): boolean {
  return actor.role === "manager" || actor.role === "owner";
}

export function canViewUnassigned(actor: PersonRow): boolean {
  return actor.role === "manager" || actor.role === "owner";
}
