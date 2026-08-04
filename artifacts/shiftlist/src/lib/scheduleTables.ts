import { pool } from "../db/index.js";

/**
 * scheduled_shifts / shift_time_rules back the Homebase CSV import. Like
 * staff_notice, the app deploys from Cloudflare (via `wrangler deploy` run
 * from the Replit shell) with no separate migration step against prod, so
 * routes that touch these tables call this first rather than assuming
 * lib/db/migrations/003_add_schedule_tables.sql was ever run by hand.
 *
 * Memoized per-isolate: CREATE TABLE IF NOT EXISTS is cheap but there's no
 * reason to run it on every request in the same isolate's lifetime.
 */
let ensured = false;

const DEFAULT_TIME_RULES: { shiftName: string; startFrom: string; startUntil: string }[] = [
  { shiftName: "Open", startFrom: "00:00", startUntil: "11:00" },
  { shiftName: "Mid", startFrom: "11:00", startUntil: "16:00" },
  { shiftName: "Close", startFrom: "16:00", startUntil: "23:59" },
];

export async function ensureScheduleTables(): Promise<void> {
  if (ensured) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduled_shifts (
      id            serial PRIMARY KEY,
      date          text NOT NULL,
      employee_id   integer NOT NULL,
      employee_name text NOT NULL,
      shift_id      integer NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
      start_time    text NOT NULL,
      end_time      text,
      source        text NOT NULL DEFAULT 'homebase_csv',
      imported_at   timestamptz NOT NULL DEFAULT now(),
      UNIQUE (date, employee_id, start_time)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS shift_time_rules (
      id          serial PRIMARY KEY,
      shift_id    integer NOT NULL UNIQUE REFERENCES shifts(id) ON DELETE CASCADE,
      start_from  text NOT NULL,
      start_until text NOT NULL
    )
  `);

  // Seed sensible defaults on first-ever run so the schedule page isn't
  // useless before anyone visits the rules editor — but only for shift
  // names that already exist, and only if no rules exist yet at all (an
  // admin who deletes every rule to reconfigure from scratch shouldn't
  // have them silently reappear on the next request).
  const { rows: existingRules } = await pool.query("SELECT COUNT(*)::int as count FROM shift_time_rules");
  if (existingRules[0].count === 0) {
    const { rows: shifts } = await pool.query("SELECT id, name FROM shifts");
    const shiftByName = new Map<string, number>(
      shifts.map((s: { id: number; name: string }) => [s.name.toLowerCase(), s.id])
    );
    for (const rule of DEFAULT_TIME_RULES) {
      const shiftId = shiftByName.get(rule.shiftName.toLowerCase());
      if (shiftId === undefined) continue;
      await pool.query(
        `INSERT INTO shift_time_rules (shift_id, start_from, start_until) VALUES ($1, $2, $3)
         ON CONFLICT (shift_id) DO NOTHING`,
        [shiftId, rule.startFrom, rule.startUntil]
      );
    }
  }

  ensured = true;
}
