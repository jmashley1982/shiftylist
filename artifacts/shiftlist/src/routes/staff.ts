import { Router } from "express";
import { pool } from "../db/index.js";
import { ensureStaffAuth } from "../middleware/auth.js";
import { getBusinessDayStr } from "../utils/dateHelpers.js";
import { logger } from "../lib/logger.js";
import { sweepStaleSessionsOnRequest } from "../utils/autoSubmit.js";

const router = Router();

router.get("/tasks", ensureStaffAuth, async (req, res) => {
  sweepStaleSessionsOnRequest();
  const today = getBusinessDayStr();
  const shiftId = req.session.selectedShiftId;

  if (!shiftId) {
    return void res.redirect("/select-shift");
  }

  const [standingRes, extraRes, compRes, shiftRes] = await Promise.all([
    pool.query(`
      SELECT t.name as task_name, st.time_start, st.time_end
      FROM shift_tasks st
      JOIN tasks t ON t.id = st.task_id
      WHERE st.shift_id = $1
      ORDER BY st.display_order
    `, [shiftId]),
    pool.query(`
      SELECT task_name, time_start, time_end
      FROM extra_day_tasks
      WHERE shift_id = $1 AND date = $2
      ORDER BY display_order
    `, [shiftId, today]),
    pool.query(`
      SELECT task_name, completed_by_name, completed_at, late_reason
      FROM task_completions
      WHERE date = $1 AND shift_id = $2
    `, [today, shiftId]),
    pool.query("SELECT name FROM shifts WHERE id = $1", [shiftId]),
  ]);

  const standingTasks = (standingRes.rows as { task_name: string; time_start: string | null; time_end: string | null }[]).map((t) => ({
    text: t.task_name,
    isExtra: false,
    timeStart: t.time_start ?? null,
    timeEnd: t.time_end ?? null,
  }));
  const extraTasks = (extraRes.rows as { task_name: string; time_start: string | null; time_end: string | null }[]).map((t) => ({
    text: t.task_name,
    isExtra: true,
    timeStart: t.time_start ?? null,
    timeEnd: t.time_end ?? null,
  }));
  // Extra (one-off) tasks go first so they stand out at the top
  const tasks = [...extraTasks, ...standingTasks];

  if (tasks.length === 0) {
    return void res.render("noTasks", { employeeName: req.session.employeeName });
  }

  const completionMap: Record<string, { byName: string; at: string; lateReason: string | null }> = {};
  for (const row of compRes.rows as {
    task_name: string;
    completed_by_name: string;
    completed_at: Date | string;
    late_reason: string | null;
  }[]) {
    completionMap[row.task_name] = {
      byName: row.completed_by_name,
      at:
        row.completed_at instanceof Date
          ? row.completed_at.toISOString()
          : String(row.completed_at),
      lateReason: row.late_reason,
    };
  }

  const shiftName =
    (shiftRes.rows[0] as { name: string } | undefined)?.name ?? "";

  // Fetch active staff notice (show if any field is non-empty)
  let staffNotice: { title: string; subtitle: string; body: string } | null = null;
  try {
    const noticeRes = await pool.query<{ title: string; subtitle: string; body: string }>(
      `SELECT title, subtitle, body FROM staff_notice ORDER BY id DESC LIMIT 1`
    );
    const n = noticeRes.rows[0];
    if (n && (n.title || n.subtitle || n.body)) staffNotice = n;
  } catch {
    // ignore — notice is non-critical
  }

  res.render("todolist", {
    tasks,
    extraCount: extraTasks.length,
    employeeName: req.session.employeeName,
    shift: shiftName,
    completionMap,
    staffNotice,
  });
});

router.post("/complete", ensureStaffAuth, async (req, res) => {
  const { taskName, lateReason } = req.body as { taskName?: string; lateReason?: string };
  const shiftId = req.session.selectedShiftId;
  const date = getBusinessDayStr();

  if (!shiftId || !taskName?.trim()) {
    return void res.status(400).json({ ok: false, error: "Missing taskName or shift" });
  }

  try {
    await pool.query(
      `INSERT INTO task_completions
         (date, shift_id, task_name, completed_by_name, completed_by_code, late_reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (date, shift_id, task_name) DO UPDATE
         SET completed_by_name = EXCLUDED.completed_by_name,
             completed_by_code = EXCLUDED.completed_by_code,
             completed_at      = task_completions.completed_at,
             late_reason       = EXCLUDED.late_reason`,
      [
        date,
        shiftId,
        taskName.trim(),
        req.session.employeeName ?? "",
        req.session.employeeCode ?? "",
        lateReason?.trim() ?? null,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to save task completion");
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

router.post("/uncomplete", ensureStaffAuth, async (req, res) => {
  const { taskName } = req.body as { taskName?: string };
  const shiftId = req.session.selectedShiftId;
  const date = getBusinessDayStr();

  if (!shiftId || !taskName?.trim()) {
    return void res.status(400).json({ ok: false, error: "Missing taskName or shift" });
  }

  try {
    await pool.query(
      `DELETE FROM task_completions
       WHERE date = $1 AND shift_id = $2 AND task_name = $3`,
      [date, shiftId, taskName.trim()]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to remove task completion");
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

router.post("/submit", ensureStaffAuth, async (req, res) => {
  interface TaskEntry {
    text: string;
    completed: boolean;
    completionTime: string | null;
    lateReason?: string | null;
  }
  let tasks: TaskEntry[] = [];
  let notes = "";
  try {
    const raw = req.body as { tasks?: string; notes?: string };
    tasks = JSON.parse(raw.tasks ?? "[]") as TaskEntry[];
    notes = raw.notes ?? "";
  } catch {
    return void res.status(400).send("Invalid task data");
  }

  const shiftId = req.session.selectedShiftId;
  const shiftName = shiftId
    ? (
        (await pool.query("SELECT name FROM shifts WHERE id = $1", [shiftId]))
          .rows[0] as { name: string } | undefined
      )?.name ?? ""
    : "";

  const date = getBusinessDayStr();
  const taskSummary = tasks
    .map((t) => {
      let s = `${t.completed ? "✓" : "✗"} ${t.text}`;
      if (t.completionTime) s += ` (${t.completionTime})`;
      if (t.lateReason) s += ` — Late: ${t.lateReason}`;
      return s;
    })
    .join(" | ");

  try {
    await pool.query(
      `INSERT INTO submissions (employee_code, employee_name, shift_name, date, task_summary, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req.session.employeeCode ?? "",
        req.session.employeeName ?? "",
        shiftName,
        date,
        taskSummary,
        notes,
      ]
    );
  } catch (err) {
    logger.error(
      { err },
      "Failed to save submission to DB — continuing with confirmation"
    );
  }

  req.session.selectedShiftId = undefined;

  // Clear active session record so admin live view shows them as finished
  try {
    await pool.query(
      "DELETE FROM active_sessions WHERE employee_id = $1 AND date = $2",
      [req.session.employeeId, date]
    );
  } catch {
    // non-fatal
  }

  res.render("submitted", {
    employeeName: req.session.employeeName,
    shift: shiftName,
    date,
    tasks,
    notes,
  });
});

export default router;
