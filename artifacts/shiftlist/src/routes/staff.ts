import { Router } from "express";
import { pool } from "../db/index.js";
import { ensureStaffAuth } from "../middleware/auth.js";
import { getTodayStr } from "../utils/dateHelpers.js";
import { logger } from "../lib/logger.js";
import { sweepStaleSessions } from "../utils/autoSubmit.js";

const router = Router();

router.get("/tasks", ensureStaffAuth, async (req, res) => {
  void sweepStaleSessions().catch(() => {});
  const today = getTodayStr();
  const shiftId = req.session.selectedShiftId;

  if (!shiftId) {
    return void res.redirect("/select-shift");
  }

  const [standingRes, extraRes, compRes, shiftRes] = await Promise.all([
    pool.query(`
      SELECT t.name as task_name
      FROM shift_tasks st
      JOIN tasks t ON t.id = st.task_id
      WHERE st.shift_id = $1
      ORDER BY st.display_order
    `, [shiftId]),
    pool.query(`
      SELECT task_name
      FROM extra_day_tasks
      WHERE shift_id = $1 AND date = $2
      ORDER BY display_order
    `, [shiftId, today]),
    pool.query(`
      SELECT task_name, completed_by_name, completed_at
      FROM task_completions
      WHERE date = $1 AND shift_id = $2
    `, [today, shiftId]),
    pool.query("SELECT name FROM shifts WHERE id = $1", [shiftId]),
  ]);

  const standingTasks = (standingRes.rows as { task_name: string }[]).map((t) => ({
    text: t.task_name,
    isExtra: false,
  }));
  const extraTasks = (extraRes.rows as { task_name: string }[]).map((t) => ({
    text: t.task_name,
    isExtra: true,
  }));
  const tasks = [...standingTasks, ...extraTasks];

  if (tasks.length === 0) {
    return void res.render("noTasks", { employeeName: req.session.employeeName });
  }

  const completionMap: Record<string, { byName: string; at: string }> = {};
  for (const row of compRes.rows as {
    task_name: string;
    completed_by_name: string;
    completed_at: Date | string;
  }[]) {
    completionMap[row.task_name] = {
      byName: row.completed_by_name,
      at:
        row.completed_at instanceof Date
          ? row.completed_at.toISOString()
          : String(row.completed_at),
    };
  }

  const shiftName =
    (shiftRes.rows[0] as { name: string } | undefined)?.name ?? "";

  res.render("todolist", {
    tasks,
    standingCount: standingTasks.length,
    employeeName: req.session.employeeName,
    shift: shiftName,
    completionMap,
  });
});

router.post("/complete", ensureStaffAuth, async (req, res) => {
  const { taskName } = req.body as { taskName?: string };
  const shiftId = req.session.selectedShiftId;
  const date = getTodayStr();

  if (!shiftId || !taskName?.trim()) {
    return void res.status(400).json({ ok: false, error: "Missing taskName or shift" });
  }

  try {
    await pool.query(
      `INSERT INTO task_completions
         (date, shift_id, task_name, completed_by_name, completed_by_code)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (date, shift_id, task_name) DO UPDATE
         SET completed_by_name = EXCLUDED.completed_by_name,
             completed_by_code = EXCLUDED.completed_by_code,
             completed_at      = NOW()`,
      [
        date,
        shiftId,
        taskName.trim(),
        req.session.employeeName ?? "",
        req.session.employeeCode ?? "",
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
  const date = getTodayStr();

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

  const date = getTodayStr();
  const taskSummary = tasks
    .map(
      (t) =>
        `${t.completed ? "✓" : "✗"} ${t.text}${t.completionTime ? ` (${t.completionTime})` : ""}`
    )
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
