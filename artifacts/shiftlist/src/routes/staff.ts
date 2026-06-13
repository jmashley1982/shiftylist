import { Router } from "express";
import { pool } from "../db/index.js";
import { ensureStaffAuth } from "../middleware/auth.js";
import { getTodayStr } from "../utils/dateHelpers.js";
import { appendToSheet } from "../utils/sheets.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.get("/tasks", ensureStaffAuth, async (req, res) => {
  const empId = req.session.employeeId!;
  const today = getTodayStr();
  const shiftId = req.session.selectedShiftId;

  if (!shiftId) {
    return void res.redirect("/select-shift");
  }

  // A single-day override takes precedence over the always-live standing list.
  const dailyShift = (await pool.query(
    "SELECT id FROM daily_shifts WHERE date = $1 AND shift_id = $2",
    [today, shiftId]
  )).rows[0];

  let taskRows: { task_name: string }[];
  if (dailyShift) {
    taskRows = (await pool.query(`
      SELECT t.name as task_name
      FROM daily_shift_tasks dst
      JOIN tasks t ON t.id = dst.task_id
      WHERE dst.daily_shift_id = $1
      ORDER BY dst.display_order
    `, [dailyShift.id])).rows;
  } else {
    // No override → use the shift's standing checklist.
    taskRows = (await pool.query(`
      SELECT t.name as task_name
      FROM shift_tasks st
      JOIN tasks t ON t.id = st.task_id
      WHERE st.shift_id = $1
      ORDER BY st.display_order
    `, [shiftId])).rows;
  }

  const tasks = taskRows.map((t: { task_name: string }) => ({ text: t.task_name }));

  if (tasks.length === 0) {
    return void res.render("noTasks", {
      employeeName: req.session.employeeName,
    });
  }

  const shiftName = (await pool.query("SELECT name FROM shifts WHERE id = $1", [shiftId])).rows[0]?.name;

  res.render("todolist", {
    tasks,
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

  let sheetsError = false;
  try {
    await appendToSheet(submission);
  } catch (err) {
    logger.error({ err }, "Google Sheets submission failed — continuing with local confirmation");
    sheetsError = true;
  }

  req.session.selectedShiftId = undefined;
  res.render("submitted", {
    employeeName: req.session.employeeName,
    shift: submission.shift,
    date: submission.date,
    tasks,
    notes,
    sheetsError,
  });
});

export default router;
