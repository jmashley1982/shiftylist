import { Router } from "express";
import type { PoolClient } from "pg";
import { pool } from "../db/index.js";
import { ensureAdminAuth } from "../middleware/auth.js";
import { adminUrl } from "../lib/urls.js";
import {
  getTodayStr,
  getBusinessDayStr,
  formatDateDisplay,
  formatLocalTime,
  addDaysToDateStr,
  getWeekStartStr,
} from "../utils/dateHelpers.js";
import { sweepStaleSessionsOnRequest } from "../utils/autoSubmit.js";
import { ensureScheduleTables } from "../lib/scheduleTables.js";
import { parseHomebaseCsv, matchShiftType, type ShiftTimeRule } from "../lib/homebaseCsv.js";

// Mounted at /admin/shifts. There is no login here anymore — ensureAdminAuth
// trusts the Viking ordering app's session cookie (see
// src/middleware/vikingAuth.ts). "/dashboard" is now the mount root, and the
// shift-checklist builder — formerly "/shifts", now redundant with the mount
// prefix — lives at "/build".

const router = Router();
router.use(ensureAdminAuth);

// ════════════════════════════════════ Helpers ═══════════════════════════════════
/** Run fn inside a BEGIN/COMMIT transaction; rolls back on error. */
async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Create the task by name if new, otherwise reuse the existing one. Returns its id. */
async function upsertTaskByName(client: PoolClient, name: string): Promise<number> {
  const res = await client.query(
    `INSERT INTO tasks (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [name]
  );
  return res.rows[0].id as number;
}

/** Build the redirect URL back to the shifts hub, preserving shift and optional extraDate. */
function hubUrl(shiftId: number | string, extraDate?: string): string {
  const base = `${adminUrl("/build")}?shift=${shiftId}`;
  return extraDate ? `${base}&extraDate=${extraDate}` : base;
}

/**
 * Renormalize a list of task rows to display_order 0, 1, 2, … in a single
 * UPDATE … FROM (VALUES …) statement.
 */
async function bulkRenormalizeOrder(
  client: PoolClient,
  table: "shift_tasks" | "extra_day_tasks",
  ids: number[]
): Promise<void> {
  if (ids.length === 0) return;
  const valuePlaceholders = ids.map((_, i) => `($${i * 2 + 1}::int, $${i * 2 + 2}::int)`).join(", ");
  const params: number[] = ids.flatMap((id, i) => [id, i]);
  await client.query(
    `UPDATE ${table} AS t
     SET display_order = vals.new_order
     FROM (VALUES ${valuePlaceholders}) AS vals(row_id, new_order)
     WHERE t.id = vals.row_id`,
    params
  );
}

// ════════════════════════════════════ Dashboard ═════════════════════════════════
// The mount root — /admin/shifts itself is the landing page.
router.get("/", async (_req, res) => {
  const today = getBusinessDayStr();

  // Previous business day: subtract one calendar day from today's date string
  const todayDate = new Date(today + "T12:00:00");
  todayDate.setDate(todayDate.getDate() - 1);
  const yesterday = todayDate.toISOString().slice(0, 10);

  let notYetOpened: string[] = [];
  try {
    await ensureScheduleTables();
    const [scheduledRes, openedRes] = await Promise.all([
      pool.query("SELECT DISTINCT employee_name FROM scheduled_shifts WHERE date = $1", [today]),
      pool.query(
        `SELECT employee_name FROM active_sessions WHERE date = $1
         UNION
         SELECT employee_name FROM submissions WHERE date = $1`,
        [today]
      ),
    ]);
    const opened = new Set((openedRes.rows as { employee_name: string }[]).map((r) => r.employee_name));
    notYetOpened = (scheduledRes.rows as { employee_name: string }[])
      .map((r) => r.employee_name)
      .filter((name) => !opened.has(name));
  } catch {
    // Schedule feature is additive — a hiccup here shouldn't break the dashboard.
    notYetOpened = [];
  }

  const [empRes, shiftRes, taskRes, extraRes, activityRes, todaySubsRes, yesNotesRes, liveResult] = await Promise.all([
    pool.query("SELECT COUNT(*) as count FROM employees"),
    pool.query("SELECT COUNT(*) as count FROM shifts"),
    pool.query("SELECT COUNT(*) as count FROM tasks"),
    pool.query("SELECT COUNT(*) as count FROM extra_day_tasks WHERE date >= $1", [today]),
    pool.query(`
      WITH parsed AS (
        SELECT
          employee_name,
          (SELECT COUNT(*) FROM unnest(string_to_array(task_summary, ' | ')) AS item WHERE item LIKE '✓%') AS completed,
          array_length(string_to_array(task_summary, ' | '), 1) AS total
        FROM submissions
        WHERE submitted_at >= NOW() - INTERVAL '30 days'
          AND task_summary <> ''
      )
      SELECT
        employee_name,
        COUNT(*)::int AS submission_count,
        ROUND(AVG(CASE WHEN total > 0 THEN completed::float / total * 100 ELSE NULL END))::int AS avg_completion_pct
      FROM parsed
      GROUP BY employee_name
      ORDER BY employee_name
    `),
    pool.query(
      `SELECT shift_name, COUNT(*)::int as count, MAX(submitted_at) as last_at
       FROM submissions WHERE date = $1 GROUP BY shift_name`,
      [today]
    ),
    pool.query(
      `SELECT employee_name, shift_name, notes, submitted_at, auto_submitted
       FROM submissions
       WHERE date = $1
         AND notes IS NOT NULL AND TRIM(notes) <> ''
       ORDER BY
         CASE LOWER(shift_name) WHEN 'open' THEN 0 WHEN 'mid' THEN 1 WHEN 'close' THEN 2 ELSE 3 END,
         submitted_at DESC`,
      [yesterday]
    ),
    fetchLiveData(today),
  ]);

  res.render("admin/dashboard", {
    employeeCount: empRes.rows[0].count,
    shiftCount: shiftRes.rows[0].count,
    taskCount: taskRes.rows[0].count,
    customCount: extraRes.rows[0].count,
    staffActivity: activityRes.rows as { employee_name: string; submission_count: number; avg_completion_pct: number | null }[],
    todaySubmissions: todaySubsRes.rows as { shift_name: string; count: number; last_at: Date }[],
    yesterdayNotes: yesNotesRes.rows as { employee_name: string; shift_name: string; notes: string; submitted_at: Date; auto_submitted: boolean }[],
    shiftData: liveResult.shiftData,
    activeSessions: liveResult.activeSessions,
    notYetOpened,
    today,
    yesterday,
    formatLocalTime,
    formatDateDisplay,
  });
});

// ════════════════════════════════════ Employees ════════════════════════════════
router.get("/employees", async (_req, res) => {
  const employees = (await pool.query("SELECT * FROM employees ORDER BY name")).rows;
  res.render("admin/employees", { employees, error: null });
});

router.post("/employees/add", async (req, res) => {
  const { name, code } = req.body as { name: string; code: string };
  if (!name || !code) return void res.redirect(adminUrl("/employees"));
  if (!/^\d{4}$/.test(code)) {
    const employees = (await pool.query("SELECT * FROM employees ORDER BY name")).rows;
    return void res.render("admin/employees", { employees, error: "Code must be exactly 4 digits." });
  }
  try {
    await pool.query("INSERT INTO employees (name, code) VALUES ($1, $2)", [name.trim(), code]);
    res.redirect(adminUrl("/employees"));
  } catch {
    const employees = (await pool.query("SELECT * FROM employees ORDER BY name")).rows;
    res.render("admin/employees", { employees, error: "That code is already in use." });
  }
});

router.post("/employees/delete/:id", async (req, res) => {
  await pool.query("DELETE FROM employees WHERE id = $1", [Number(req.params.id)]);
  res.redirect(adminUrl("/employees"));
});

// ════════════════════════════════════ Shifts hub ════════════════════════════════
router.get("/build", async (req, res) => {
  const today = getTodayStr();
  const shifts = (await pool.query(
    `SELECT * FROM shifts ORDER BY CASE LOWER(name) WHEN 'open' THEN 0 WHEN 'mid' THEN 1 WHEN 'close' THEN 2 ELSE 3 END, name`
  )).rows;

  const requestedShift = Number(req.query.shift);
  const selectedShift =
    shifts.find((s: { id: number }) => s.id === requestedShift) || shifts[0] || null;

  const allTasks = (await pool.query("SELECT * FROM tasks ORDER BY name")).rows;

  // extraDate lets admin browse extra tasks for any date (defaults to today)
  const rawExtraDate = typeof req.query.extraDate === "string" ? req.query.extraDate.trim() : "";
  const extraDate = /^\d{4}-\d{2}-\d{2}$/.test(rawExtraDate) ? rawExtraDate : today;

  let standingTasks: { id: number; task_name: string; display_order: number; time_start: string | null; time_end: string | null }[] = [];
  let extraTasks: { id: number; task_name: string; display_order: number; time_start: string | null; time_end: string | null }[] = [];

  if (selectedShift) {
    const [stRes, etRes] = await Promise.all([
      pool.query(
        `SELECT st.id, st.display_order, st.time_start, st.time_end, t.name as task_name
         FROM shift_tasks st
         JOIN tasks t ON t.id = st.task_id
         WHERE st.shift_id = $1
         ORDER BY st.display_order`,
        [selectedShift.id]
      ),
      pool.query(
        `SELECT id, task_name, display_order, time_start, time_end
         FROM extra_day_tasks
         WHERE shift_id = $1 AND date = $2
         ORDER BY display_order`,
        [selectedShift.id, extraDate]
      ),
    ]);
    standingTasks = stRes.rows;
    extraTasks = etRes.rows;
  }

  res.render("admin/shifts", {
    shifts,
    selectedShift,
    allTasks,
    standingTasks,
    extraTasks,
    extraDate,
    today,
    formatDateDisplay,
  });
});

// ── Add a Task (unified: daily → standing list, one-off → extra day tasks) ────
router.post("/build/add-task", async (req, res) => {
  const body = req.body as {
    name?: string;
    type?: string;
    shiftIds?: string | string[];
    date?: string;
    time_start?: string;
    time_end?: string;
  };

  const name = body.name?.trim();
  if (!name) return void res.redirect(adminUrl("/build"));

  const type = body.type === "daily" ? "daily" : "oneoff";
  const rawIds = Array.isArray(body.shiftIds)
    ? body.shiftIds
    : body.shiftIds
    ? [body.shiftIds]
    : [];
  const shiftIds = rawIds.map(Number).filter((n) => n > 0);
  const date = body.date?.trim() || getTodayStr();
  const timeStart = body.time_start?.trim() || null;
  const timeEnd = body.time_end?.trim() || null;

  if (shiftIds.length === 0) return void res.redirect(adminUrl("/build"));

  if (type === "daily") {
    await withTransaction(async (client) => {
      const taskId = await upsertTaskByName(client, name);
      for (const shiftId of shiftIds) {
        const maxRow = (
          await client.query(
            "SELECT COALESCE(MAX(display_order), -1) as max FROM shift_tasks WHERE shift_id = $1",
            [shiftId]
          )
        ).rows[0];
        await client.query(
          `INSERT INTO shift_tasks (shift_id, task_id, display_order, time_start, time_end) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (shift_id, task_id) DO NOTHING`,
          [shiftId, taskId, (maxRow.max as number) + 1, timeStart, timeEnd]
        );
      }
    });
  } else {
    for (const shiftId of shiftIds) {
      const maxRow = (
        await pool.query(
          "SELECT COALESCE(MAX(display_order), -1) as max FROM extra_day_tasks WHERE shift_id = $1 AND date = $2",
          [shiftId, date]
        )
      ).rows[0];
      await pool.query(
        "INSERT INTO extra_day_tasks (shift_id, date, task_name, display_order, time_start, time_end) VALUES ($1, $2, $3, $4, $5, $6)",
        [shiftId, date, name, (maxRow.max as number) + 1, timeStart, timeEnd]
      );
    }
  }

  res.redirect(shiftIds.length === 1 ? hubUrl(shiftIds[0]) : adminUrl("/build"));
});

// ── Shift types ──────────────────────────────────────────────────────────────
router.post("/build/add", async (req, res) => {
  const { name } = req.body as { name: string };
  if (name?.trim()) {
    const r = await pool.query(
      "INSERT INTO shifts (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING id",
      [name.trim()]
    );
    if (r.rows[0]) return void res.redirect(hubUrl(r.rows[0].id));
  }
  res.redirect(adminUrl("/build"));
});

router.post("/build/delete/:id", async (req, res) => {
  await pool.query("DELETE FROM shifts WHERE id = $1", [Number(req.params.id)]);
  res.redirect(adminUrl("/build"));
});

// ── Standing list (always live) ──────────────────────────────────────────────
router.post("/build/:shiftId/standing/add", async (req, res) => {
  const shiftId = Number(req.params.shiftId);
  const name = (req.body.name as string)?.trim();
  const wantsJson = req.headers.accept?.includes("application/json") ?? false;

  let shiftTaskId: number | null = null;
  let created = false;

  if (name) {
    await withTransaction(async (client) => {
      await client.query("SELECT id FROM shifts WHERE id = $1 FOR UPDATE", [shiftId]);

      const taskId = await upsertTaskByName(client, name);
      const maxRow = (await client.query(
        "SELECT COALESCE(MAX(display_order), -1) as max FROM shift_tasks WHERE shift_id = $1",
        [shiftId]
      )).rows[0];
      const inserted = await client.query(
        `INSERT INTO shift_tasks (shift_id, task_id, display_order) VALUES ($1, $2, $3)
         ON CONFLICT (shift_id, task_id) DO NOTHING
         RETURNING id`,
        [shiftId, taskId, (maxRow.max as number) + 1]
      );
      if (inserted.rows[0]) {
        shiftTaskId = inserted.rows[0].id;
        created = true;
      } else {
        const existing = await client.query(
          "SELECT id FROM shift_tasks WHERE shift_id = $1 AND task_id = $2",
          [shiftId, taskId]
        );
        shiftTaskId = existing.rows[0]?.id ?? null;
        created = false;
      }
    });
  }

  if (wantsJson) {
    if (shiftTaskId !== null && name) {
      res.json({ id: shiftTaskId, name, created });
    } else {
      res.status(400).json({ error: "Invalid task name" });
    }
    return;
  }

  res.redirect(hubUrl(shiftId));
});

router.post("/build/:shiftId/standing/remove/:id", async (req, res) => {
  await pool.query("DELETE FROM shift_tasks WHERE id = $1", [Number(req.params.id)]);
  res.redirect(hubUrl(req.params.shiftId));
});

router.post("/build/:shiftId/standing/rename/:id", async (req, res) => {
  const shiftTaskId = Number(req.params.id);
  const shiftId = Number(req.params.shiftId);
  const name = (req.body.name as string)?.trim();
  if (!name) return void res.json({ ok: false, error: "Name required" });
  await withTransaction(async (client) => {
    const taskId = await upsertTaskByName(client, name);
    await client.query(
      "UPDATE shift_tasks SET task_id = $1 WHERE id = $2 AND shift_id = $3",
      [taskId, shiftTaskId, shiftId]
    );
  });
  res.json({ ok: true });
});

router.post("/build/:shiftId/standing/reorder", async (req, res) => {
  const shiftId = Number(req.params.shiftId);
  const ids = (req.body.ids as unknown[]);
  if (!Array.isArray(ids) || ids.length === 0) return void res.json({ ok: false });
  const idArray = ids.map(Number).filter(n => n > 0);
  await withTransaction(async (client) => {
    await client.query("SELECT id FROM shifts WHERE id = $1 FOR UPDATE", [shiftId]);
    await bulkRenormalizeOrder(client, "shift_tasks", idArray);
  });
  res.json({ ok: true });
});

// ── Extra tasks for a specific day ──────────────────────────────────────────
router.post("/build/:shiftId/standing/set-time/:id", async (req, res) => {
  const id = Number(req.params.id);
  const shiftId = Number(req.params.shiftId);
  const body = req.body as { time_start?: string; time_end?: string };
  const timeStart = body.time_start?.trim() || null;
  const timeEnd = body.time_end?.trim() || null;
  await pool.query(
    "UPDATE shift_tasks SET time_start = $1, time_end = $2 WHERE id = $3 AND shift_id = $4",
    [timeStart, timeEnd, id, shiftId]
  );
  res.json({ ok: true });
});

router.post("/build/:shiftId/day/:date/remove-extra/:id", async (req, res) => {
  await pool.query("DELETE FROM extra_day_tasks WHERE id = $1", [Number(req.params.id)]);
  res.redirect(hubUrl(req.params.shiftId, req.params.date));
});

router.post("/build/:shiftId/day/:date/rename-extra/:id", async (req, res) => {
  const id = Number(req.params.id);
  const name = (req.body.name as string)?.trim();
  if (!name) return void res.json({ ok: false, error: "Name required" });
  await pool.query(
    "UPDATE extra_day_tasks SET task_name = $1 WHERE id = $2 AND shift_id = $3 AND date = $4",
    [name, id, Number(req.params.shiftId), req.params.date]
  );
  res.json({ ok: true });
});

router.post("/build/:shiftId/day/:date/set-time-extra/:id", async (req, res) => {
  const id = Number(req.params.id);
  const shiftId = Number(req.params.shiftId);
  const { date } = req.params;
  const body = req.body as { time_start?: string; time_end?: string };
  const timeStart = body.time_start?.trim() || null;
  const timeEnd = body.time_end?.trim() || null;
  await pool.query(
    "UPDATE extra_day_tasks SET time_start = $1, time_end = $2 WHERE id = $3 AND shift_id = $4 AND date = $5",
    [timeStart, timeEnd, id, shiftId, date]
  );
  res.json({ ok: true });
});

router.post("/build/:shiftId/day/:date/reorder-extra", async (req, res) => {
  const shiftId = Number(req.params.shiftId);
  const { date } = req.params;
  const ids = (req.body.ids as unknown[]);
  if (!Array.isArray(ids) || ids.length === 0) return void res.json({ ok: false });
  const idArray = ids.map(Number).filter(n => n > 0);
  await withTransaction(async (client) => {
    await client.query(
      "SELECT id FROM extra_day_tasks WHERE shift_id = $1 AND date = $2 LIMIT 1 FOR UPDATE",
      [shiftId, date]
    );
    await bulkRenormalizeOrder(client, "extra_day_tasks", idArray);
  });
  res.json({ ok: true });
});

// ════════════════════════════════════ Live Status ════════════════════════════

interface LiveTask {
  name: string;
  isExtra: boolean;
  completed: boolean;
  completedBy: string | null;
  completedAtIso: string | null;
}

interface LiveShiftData {
  shift: { id: number; name: string };
  tasks: LiveTask[];
  done: number;
  total: number;
}

interface ActiveStaffSession {
  employeeName: string;
  shiftName: string;
  startedAtIso: string;
}

interface LiveData {
  shiftData: LiveShiftData[];
  activeSessions: ActiveStaffSession[];
}

async function fetchLiveData(today: string): Promise<LiveData> {
  const shifts = (await pool.query(
    `SELECT * FROM shifts ORDER BY CASE LOWER(name) WHEN 'open' THEN 0 WHEN 'mid' THEN 1 WHEN 'close' THEN 2 ELSE 3 END, name`
  )).rows as { id: number; name: string }[];

  // Fetch active sessions and shift data concurrently
  const [shiftData, activeSessionsRes] = await Promise.all([
    Promise.all(
      shifts.map(async (shift) => {
        const [standingRes, extraRes, compRes] = await Promise.all([
          pool.query(
            `SELECT t.name as task_name FROM shift_tasks st
             JOIN tasks t ON t.id = st.task_id
             WHERE st.shift_id = $1 ORDER BY st.display_order`,
            [shift.id]
          ),
          pool.query(
            `SELECT task_name FROM extra_day_tasks
             WHERE shift_id = $1 AND date = $2 ORDER BY display_order`,
            [shift.id, today]
          ),
          pool.query(
            `SELECT task_name, completed_by_name, completed_at
             FROM task_completions WHERE date = $1 AND shift_id = $2`,
            [today, shift.id]
          ),
        ]);

        const compMap = new Map<string, { by: string; at: string }>();
        for (const row of compRes.rows as {
          task_name: string;
          completed_by_name: string;
          completed_at: Date | string;
        }[]) {
          compMap.set(row.task_name, {
            by: row.completed_by_name,
            at:
              row.completed_at instanceof Date
                ? row.completed_at.toISOString()
                : String(row.completed_at),
          });
        }

        const tasks: LiveTask[] = [
          ...(standingRes.rows as { task_name: string }[]).map((r) => ({
            name: r.task_name,
            isExtra: false,
          })),
          ...(extraRes.rows as { task_name: string }[]).map((r) => ({
            name: r.task_name,
            isExtra: true,
          })),
        ].map((t) => {
          const c = compMap.get(t.name);
          return {
            name: t.name,
            isExtra: t.isExtra,
            completed: !!c,
            completedBy: c?.by ?? null,
            completedAtIso: c?.at ?? null,
          };
        });

        const done = tasks.filter((t) => t.completed).length;
        return { shift, tasks, done, total: tasks.length };
      })
    ),
    pool.query(
      `SELECT employee_name, shift_name, started_at
       FROM active_sessions
       WHERE date = $1
       ORDER BY started_at`,
      [today]
    ),
  ]);

  const activeSessions: ActiveStaffSession[] = (
    activeSessionsRes.rows as {
      employee_name: string;
      shift_name: string;
      started_at: Date | string;
    }[]
  ).map((r) => ({
    employeeName: r.employee_name,
    shiftName: r.shift_name,
    startedAtIso:
      r.started_at instanceof Date
        ? r.started_at.toISOString()
        : String(r.started_at),
  }));

  return { shiftData, activeSessions };
}

router.get("/live", async (_req, res) => {
  sweepStaleSessionsOnRequest();
  const today = getBusinessDayStr();
  const { shiftData, activeSessions } = await fetchLiveData(today);
  res.render("admin/live", { shiftData, activeSessions, today, formatDateDisplay });
});

router.get("/live/data", async (_req, res) => {
  const today = getBusinessDayStr();
  const { shiftData, activeSessions } = await fetchLiveData(today);
  res.json({ shiftData, activeSessions, today });
});

// ════════════════════════════════════ Schedule (Homebase import) ═════════════
//
// Homebase's API is Enterprise-tier; the store is on a lower plan. Instead,
// a manager exports the week's schedule from Homebase as a CSV and uploads it
// here. scheduled_shifts is who is *supposed* to work — task_completions,
// active_sessions and submissions (used elsewhere in this file) are what
// *actually happened*. /schedule/report cross-references the two.

interface MatchedScheduleRow {
  employeeId: number;
  employeeName: string;
  date: string;
  shiftId: number;
  shiftName: string;
  startTime: string;
  endTime: string | null;
}

function isMatchedScheduleRow(r: unknown): r is MatchedScheduleRow {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.employeeId === "number" &&
    typeof o.employeeName === "string" &&
    typeof o.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(o.date) &&
    typeof o.shiftId === "number" &&
    typeof o.shiftName === "string" &&
    typeof o.startTime === "string" &&
    /^\d{2}:\d{2}$/.test(o.startTime) &&
    (o.endTime === null || typeof o.endTime === "string")
  );
}

/** Loads everything the schedule grid needs for the week starting weekStart. */
async function loadScheduleWeek(weekStart: string) {
  const weekDates = Array.from({ length: 7 }, (_, i) => addDaysToDateStr(weekStart, i));

  const [shiftsRes, rulesRes, scheduledRes] = await Promise.all([
    pool.query(
      `SELECT * FROM shifts ORDER BY CASE LOWER(name) WHEN 'open' THEN 0 WHEN 'mid' THEN 1 WHEN 'close' THEN 2 ELSE 3 END, name`
    ),
    pool.query(
      `SELECT r.shift_id as "shiftId", s.name as "shiftName", r.start_from as "startFrom", r.start_until as "startUntil"
       FROM shift_time_rules r JOIN shifts s ON s.id = r.shift_id
       ORDER BY r.start_from`
    ),
    pool.query(
      `SELECT date, employee_name, shift_id, start_time, end_time
       FROM scheduled_shifts WHERE date = ANY($1::text[])
       ORDER BY start_time`,
      [weekDates]
    ),
  ]);

  const shifts = shiftsRes.rows as { id: number; name: string }[];
  const rules = rulesRes.rows as ShiftTimeRule[];

  const grid = new Map<string, Map<number, { employeeName: string; startTime: string; endTime: string | null }[]>>();
  for (const date of weekDates) grid.set(date, new Map(shifts.map((s) => [s.id, []])));
  for (const row of scheduledRes.rows as {
    date: string;
    employee_name: string;
    shift_id: number;
    start_time: string;
    end_time: string | null;
  }[]) {
    const dayMap = grid.get(row.date);
    if (!dayMap) continue;
    if (!dayMap.has(row.shift_id)) dayMap.set(row.shift_id, []);
    dayMap.get(row.shift_id)!.push({ employeeName: row.employee_name, startTime: row.start_time, endTime: row.end_time });
  }

  return {
    shifts,
    rules,
    weekDates,
    weekStart,
    prevWeek: addDaysToDateStr(weekStart, -7),
    nextWeek: addDaysToDateStr(weekStart, 7),
    grid,
  };
}

function resolveWeekParam(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : getBusinessDayStr();
  return getWeekStartStr(anchor);
}

router.get("/schedule", async (req, res) => {
  await ensureScheduleTables();
  await pool.query("DELETE FROM scheduled_shifts WHERE date::date < CURRENT_DATE - INTERVAL '60 days'");

  const weekStart = resolveWeekParam(req.query.week);
  const week = await loadScheduleWeek(weekStart);

  res.render("admin/schedule", {
    ...week,
    today: getBusinessDayStr(),
    preview: null,
    imported: req.query.imported ? Number(req.query.imported) : null,
    importError: req.query.importError === "1",
    rulesSaved: req.query.rulesSaved === "1",
    formatDateDisplay,
  });
});

router.post("/schedule/preview", async (req, res) => {
  await ensureScheduleTables();
  const weekStart = resolveWeekParam(req.body.week);
  const csvText = typeof req.body.csvText === "string" ? req.body.csvText : "";

  const { rows: parsedRows, skipped: parseSkipped } = parseHomebaseCsv(csvText);

  const [empRes, rulesRes] = await Promise.all([
    pool.query("SELECT id, name FROM employees"),
    pool.query(
      `SELECT r.shift_id as "shiftId", s.name as "shiftName", r.start_from as "startFrom", r.start_until as "startUntil"
       FROM shift_time_rules r JOIN shifts s ON s.id = r.shift_id`
    ),
  ]);
  const employeesByName = new Map<string, { id: number; name: string }>(
    (empRes.rows as { id: number; name: string }[]).map((e) => [e.name.trim().toLowerCase(), e])
  );
  const rules = rulesRes.rows as ShiftTimeRule[];

  const matched: MatchedScheduleRow[] = [];
  const issues: { reason: string; detail: string }[] = [];

  for (const row of parsedRows) {
    const emp = employeesByName.get(row.employeeName.trim().toLowerCase());
    if (!emp) {
      issues.push({
        reason: "Unknown employee",
        detail: `"${row.employeeName}" on ${row.date} — not in the staff list, skipped`,
      });
      continue;
    }
    const rule = matchShiftType(row.startTime, rules);
    if (!rule) {
      issues.push({
        reason: "No matching shift",
        detail: `${emp.name} starts at ${row.startTime} on ${row.date} — no shift's time window covers that, skipped`,
      });
      continue;
    }
    matched.push({
      employeeId: emp.id,
      employeeName: emp.name,
      date: row.date,
      shiftId: rule.shiftId,
      shiftName: rule.shiftName,
      startTime: row.startTime,
      endTime: row.endTime,
    });
  }

  for (const s of parseSkipped) {
    issues.push({ reason: "Unreadable row", detail: `Row ${s.rowNumber}: ${s.reason}` });
  }

  const week = await loadScheduleWeek(weekStart);

  res.render("admin/schedule", {
    ...week,
    today: getBusinessDayStr(),
    preview: { matched, issues, matchedJson: JSON.stringify(matched) },
    imported: null,
    importError: false,
    rulesSaved: false,
    formatDateDisplay,
  });
});

router.post("/schedule/commit", async (req, res) => {
  await ensureScheduleTables();
  const weekStart = resolveWeekParam(req.body.week);

  let parsed: unknown = [];
  try {
    parsed = JSON.parse(typeof req.body.matchedJson === "string" ? req.body.matchedJson : "[]");
  } catch {
    parsed = [];
  }
  const rows = (Array.isArray(parsed) ? parsed : []).filter(isMatchedScheduleRow);

  if (rows.length === 0) {
    return void res.redirect(`${adminUrl("/schedule")}?week=${weekStart}&importError=1`);
  }

  const dates = [...new Set(rows.map((r) => r.date))];

  await withTransaction(async (client) => {
    await client.query("DELETE FROM scheduled_shifts WHERE date = ANY($1::text[])", [dates]);
    for (const r of rows) {
      await client.query(
        `INSERT INTO scheduled_shifts (date, employee_id, employee_name, shift_id, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (date, employee_id, start_time) DO NOTHING`,
        [r.date, r.employeeId, r.employeeName, r.shiftId, r.startTime, r.endTime]
      );
    }
  });

  res.redirect(`${adminUrl("/schedule")}?week=${weekStart}&imported=${rows.length}`);
});

router.post("/schedule/rules", async (req, res) => {
  await ensureScheduleTables();
  const body = req.body as Record<string, string>;
  const weekStart = resolveWeekParam(body.week);

  const shiftsRes = await pool.query("SELECT id FROM shifts");
  for (const { id } of shiftsRes.rows as { id: number }[]) {
    const startFrom = (body[`start_from_${id}`] || "").trim();
    const startUntil = (body[`start_until_${id}`] || "").trim();
    if (!/^\d{2}:\d{2}$/.test(startFrom) || !/^\d{2}:\d{2}$/.test(startUntil)) continue;
    await pool.query(
      `INSERT INTO shift_time_rules (shift_id, start_from, start_until) VALUES ($1, $2, $3)
       ON CONFLICT (shift_id) DO UPDATE SET start_from = EXCLUDED.start_from, start_until = EXCLUDED.start_until`,
      [id, startFrom, startUntil]
    );
  }

  res.redirect(`${adminUrl("/schedule")}?week=${weekStart}&rulesSaved=1`);
});

router.get("/schedule/report", async (_req, res) => {
  await ensureScheduleTables();
  const today = getBusinessDayStr();
  const windowStart = addDaysToDateStr(today, -30);

  const [schedRes, subsRes, activeRes, compRes] = await Promise.all([
    pool.query(
      `SELECT ss.date, ss.employee_name, ss.shift_id, s.name as shift_name, ss.start_time
       FROM scheduled_shifts ss JOIN shifts s ON s.id = ss.shift_id
       WHERE ss.date >= $1 AND ss.date <= $2
       ORDER BY ss.date DESC, ss.start_time`,
      [windowStart, today]
    ),
    pool.query(
      `SELECT employee_name, date, shift_name, auto_submitted FROM submissions WHERE date >= $1 AND date <= $2`,
      [windowStart, today]
    ),
    pool.query(`SELECT employee_name, shift_name, date FROM active_sessions WHERE date >= $1 AND date <= $2`, [
      windowStart,
      today,
    ]),
    pool.query(
      `SELECT DISTINCT completed_by_name, date, shift_id FROM task_completions WHERE date >= $1 AND date <= $2`,
      [windowStart, today]
    ),
  ]);

  const key = (date: string, shift: string, name: string) => `${date}|${shift}|${name}`;

  const submittedMap = new Map<string, boolean>();
  for (const r of subsRes.rows as { employee_name: string; date: string; shift_name: string; auto_submitted: boolean }[]) {
    submittedMap.set(key(r.date, r.shift_name, r.employee_name), r.auto_submitted);
  }

  const openedByShiftName = new Set<string>();
  for (const r of activeRes.rows as { employee_name: string; shift_name: string; date: string }[]) {
    openedByShiftName.add(key(r.date, r.shift_name, r.employee_name));
  }
  const openedByShiftId = new Set<string>();
  for (const r of compRes.rows as { completed_by_name: string; date: string; shift_id: number }[]) {
    openedByShiftId.add(`${r.date}|${r.shift_id}|${r.completed_by_name}`);
  }

  interface ReportRow {
    date: string;
    employeeName: string;
    shiftName: string;
    shiftId: number;
    startTime: string;
    status: "submitted" | "auto_submitted" | "opened_not_submitted" | "never_opened";
  }

  const reportRows: ReportRow[] = (
    schedRes.rows as { date: string; employee_name: string; shift_id: number; shift_name: string; start_time: string }[]
  ).map((r) => {
    const k = key(r.date, r.shift_name, r.employee_name);
    let status: ReportRow["status"];
    if (submittedMap.has(k)) {
      status = submittedMap.get(k) ? "auto_submitted" : "submitted";
    } else if (openedByShiftName.has(k) || openedByShiftId.has(`${r.date}|${r.shift_id}|${r.employee_name}`)) {
      status = "opened_not_submitted";
    } else {
      status = "never_opened";
    }
    return {
      date: r.date,
      employeeName: r.employee_name,
      shiftName: r.shift_name,
      shiftId: r.shift_id,
      startTime: r.start_time,
      status,
    };
  });

  const summaryMap = new Map<
    string,
    { scheduled: number; submitted: number; openedNotSubmitted: number; neverOpened: number; misses: ReportRow[] }
  >();
  for (const row of reportRows) {
    if (!summaryMap.has(row.employeeName)) {
      summaryMap.set(row.employeeName, { scheduled: 0, submitted: 0, openedNotSubmitted: 0, neverOpened: 0, misses: [] });
    }
    const s = summaryMap.get(row.employeeName)!;
    s.scheduled++;
    if (row.status === "submitted" || row.status === "auto_submitted") s.submitted++;
    else if (row.status === "opened_not_submitted") {
      s.openedNotSubmitted++;
      s.misses.push(row);
    } else {
      s.neverOpened++;
      s.misses.push(row);
    }
  }

  const summary = [...summaryMap.entries()]
    .map(([employeeName, s]) => ({ employeeName, ...s }))
    .sort((a, b) => b.neverOpened - a.neverOpened || a.employeeName.localeCompare(b.employeeName));

  res.render("admin/schedule-report", {
    reportRows,
    summary,
    windowStart,
    today,
    formatDateDisplay,
    formatLocalTime,
  });
});

// ════════════════════════════════════ Reports ═════════════════════════════════
router.get("/reports", async (req, res) => {
  sweepStaleSessionsOnRequest();
  try {
    await Promise.all([
      pool.query("DELETE FROM submissions WHERE submitted_at < NOW() - INTERVAL '30 days'"),
      pool.query("DELETE FROM task_completions WHERE date::date < CURRENT_DATE - INTERVAL '30 days'"),
    ]);
    const employeeFilter = typeof req.query.employee === "string" && req.query.employee.trim()
      ? req.query.employee.trim()
      : null;
    const rows = (await pool.query(
      employeeFilter
        ? "SELECT * FROM submissions WHERE submitted_at >= NOW() - INTERVAL '30 days' AND employee_name = $1 ORDER BY submitted_at DESC"
        : "SELECT * FROM submissions WHERE submitted_at >= NOW() - INTERVAL '30 days' ORDER BY submitted_at DESC",
      employeeFilter ? [employeeFilter] : []
    )).rows;

    const shiftOrder = (n: string) => {
      const l = n.toLowerCase();
      return l === "open" ? 0 : l === "mid" ? 1 : l === "close" ? 2 : 3;
    };

    const dateMap = new Map<string, Map<string, typeof rows>>();
    for (const row of rows) {
      const date = (row.date as string) || "unknown";
      if (!dateMap.has(date)) dateMap.set(date, new Map());
      const sm = dateMap.get(date)!;
      const shift = (row.shift_name as string) || "—";
      if (!sm.has(shift)) sm.set(shift, []);
      sm.get(shift)!.push(row);
    }

    const groups = [...dateMap.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, sm]) => {
        const d = new Date(date + "T12:00:00");
        const label = d.toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
        });
        const shifts = [...sm.entries()]
          .sort(([a], [b]) => shiftOrder(a) - shiftOrder(b) || a.localeCompare(b))
          .map(([shiftName, items]) => ({ shiftName, items }));
        return { date, label, shifts };
      });

    res.render("admin/reports", { groups, dbError: false, employeeFilter, formatLocalTime });
  } catch (err) {
    const { logger } = await import("../lib/logger.js");
    logger.error({ err }, "Failed to load submissions from DB");
    res.render("admin/reports", { groups: [], dbError: true, employeeFilter: null, formatLocalTime });
  }
});

// ── Staff Notice ─────────────────────────────────────────────────────────────

router.get("/notice", async (req, res) => {
  const empty = { title: "", subtitle: "", body: "", updated_at: null };
  try {
    const r = await pool.query(
      `SELECT title, subtitle, body, updated_at FROM staff_notice ORDER BY id DESC LIMIT 1`
    );
    const notice = r.rows[0] ?? empty;
    const saved = req.query.saved === "1";
    res.render("admin/notice", { notice, saved, formatLocalTime });
  } catch {
    res.render("admin/notice", { notice: empty, saved: false, formatLocalTime });
  }
});

router.post("/notice", async (req, res) => {
  const clear = req.body.clear === "1";
  const title    = clear ? "" : String(req.body.title    ?? "").trim().slice(0, 80);
  const subtitle = clear ? "" : String(req.body.subtitle ?? "").trim().slice(0, 120);
  const body     = clear ? "" : String(req.body.body     ?? "").trim().slice(0, 1000);

  await pool.query(
    `INSERT INTO staff_notice (title, subtitle, body, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT DO NOTHING`,
    [title, subtitle, body]
  );
  // Always upsert by deleting all rows then inserting one
  await pool.query(`DELETE FROM staff_notice`);
  await pool.query(
    `INSERT INTO staff_notice (title, subtitle, body, updated_at) VALUES ($1, $2, $3, NOW())`,
    [title, subtitle, body]
  );

  res.redirect(`${adminUrl("/notice")}?saved=1`);
});

export default router;
