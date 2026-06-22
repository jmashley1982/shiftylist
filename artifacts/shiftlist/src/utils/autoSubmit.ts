import { pool } from "../db/index.js";
import { getTodayStr } from "./dateHelpers.js";

const CUTOFF_HOUR = 1; // 1:00 AM local time

/** Returns the current local hour (0–23) in the store's configured timezone. */
function localHour(): number {
  const tz = process.env.STORE_TIMEZONE ?? "America/Chicago";
  return parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
    10
  );
}

/**
 * Auto-submits any active_sessions whose date is before today AND it is
 * currently past CUTOFF_HOUR local time. Safe to call fire-and-forget —
 * errors are logged but never propagated.
 *
 * Triggered on GET /admin/live, GET /admin/reports, and GET /staff/tasks
 * so it runs on natural app usage without a cron job.
 */
export async function sweepStaleSessions(): Promise<void> {
  if (localHour() < CUTOFF_HOUR) return;

  const today = getTodayStr();

  const staleRes = await pool.query<{
    id: number;
    employee_code: string;
    employee_name: string;
    shift_id: number;
    shift_name: string;
    date: string;
  }>(
    `SELECT id, '' AS employee_code, employee_name, shift_id, shift_name, date
     FROM active_sessions
     WHERE date < $1`,
    [today]
  );

  if (staleRes.rowCount === 0) return;

  const { logger } = await import("../lib/logger.js");
  let submitted = 0;

  for (const session of staleRes.rows) {
    try {
      const [standingRes, extraRes, compRes] = await Promise.all([
        pool.query<{ task_name: string }>(
          `SELECT t.name AS task_name
           FROM shift_tasks st
           JOIN tasks t ON t.id = st.task_id
           WHERE st.shift_id = $1
           ORDER BY st.display_order`,
          [session.shift_id]
        ),
        pool.query<{ task_name: string }>(
          `SELECT task_name
           FROM extra_day_tasks
           WHERE shift_id = $1 AND date = $2
           ORDER BY display_order`,
          [session.shift_id, session.date]
        ),
        pool.query<{ task_name: string }>(
          `SELECT task_name
           FROM task_completions
           WHERE shift_id = $1 AND date = $2`,
          [session.shift_id, session.date]
        ),
      ]);

      const completedSet = new Set(compRes.rows.map((r) => r.task_name));
      const allTasks = [
        ...standingRes.rows.map((r) => r.task_name),
        ...extraRes.rows.map((r) => r.task_name),
      ];

      const taskSummary = allTasks.length
        ? allTasks.map((name) => `${completedSet.has(name) ? "✓" : "✗"} ${name}`).join(" | ")
        : "No tasks recorded.";

      await pool.query(
        `INSERT INTO submissions
           (employee_code, employee_name, shift_name, date, task_summary, notes)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [
          "",
          session.employee_name,
          session.shift_name,
          session.date,
          taskSummary,
          "Auto-submitted: shift not closed before 1:00 AM cutoff.",
        ]
      );

      await pool.query(`DELETE FROM active_sessions WHERE id = $1`, [session.id]);
      submitted++;
    } catch (err) {
      const { logger: log } = await import("../lib/logger.js");
      log.error({ err, sessionId: session.id }, "sweepStaleSessions: failed to auto-submit session");
    }
  }

  if (submitted > 0) {
    logger.info({ submitted }, "sweepStaleSessions: auto-submitted stale sessions");
  }
}
