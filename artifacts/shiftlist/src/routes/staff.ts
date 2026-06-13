import { Router } from "express";
import { pool } from "../db/index.js";
import { ensureStaffAuth } from "../middleware/auth.js";
import { getTodayStr } from "../utils/dateHelpers.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.get("/tasks", ensureStaffAuth, async (req, res) => {
  const empId = req.session.employeeId!;
  const today = getTodayStr();
  const shiftId = req.session.selectedShiftId;

  if (!shiftId) {
    return void res.redirect("/select-shift");
  }

  // Always load the standing checklist for this shift.
  const standingRows = (await pool.query(`
    SELECT t.name as task_name
    FROM shift_tasks st
    JOIN tasks t ON t.id = st.task_id
    WHERE st.shift_id = $1
    ORDER BY st.display_order
  `, [shiftId])).rows as { task_name: string }[];

  // Append any extra tasks added for today's date + shift.
  const extraRows = (await pool.query(`
    SELECT task_name
    FROM extra_day_tasks
    WHERE shift_id = $1 AND date = $2
    ORDER BY display_order
  `, [shiftId, today])).rows as { task_name: string }[];

  const standingTasks = standingRows.map((t) => ({ text: t.task_name, isExtra: false }));
  const extraTasks = extraRows.map((t) => ({ text: t.task_name, isExtra: true }));
  const tasks = [...standingTasks, ...extraTasks];

  if (tasks.length === 0) {
    return void res.render("noTasks", {
      employeeName: req.session.employeeName,
    });
  }

  const shiftName = (await pool.query("SELECT name FROM shifts WHERE id = $1", [shiftId])).rows[0]?.name;

  res.render("todolist", {
    tasks,
    standingCount: standingTasks.length,
    employeeName: req.session.employeeName,
    shift: shiftName,
  });
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
    ? (await pool.query("SELECT name FROM shifts WHERE id = $1", [shiftId])).rows[0]?.name ?? ""
    : "";

  const submission = {
    timestamp: new Date().toISOString(),
    userCode: req.session.employeeCode ?? "",
    employeeName: req.session.employeeName ?? "",
    shift: shiftName,
    date: getTodayStr(),
    tasks,
    notes,
  };

  const taskSummary = tasks
    .map((t) => `${t.completed ? "✓" : "✗"} ${t.text}${t.completionTime ? ` (${t.completionTime})` : ""}`)
    .join(" | ");

  try {
    await pool.query(
      `INSERT INTO submissions (employee_code, employee_name, shift_name, date, task_summary, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [submission.userCode, submission.employeeName, submission.shift, submission.date, taskSummary, notes]
    );
  } catch (err) {
    logger.error({ err }, "Failed to save submission to DB — continuing with confirmation");
  }

  req.session.selectedShiftId = undefined;
  res.render("submitted", {
    employeeName: req.session.employeeName,
    shift: submission.shift,
    date: submission.date,
    tasks,
    notes,
    sheetsError: false,
  });
});

export default router;
