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

  // Find the daily shift for today + selected shift
  const dailyShiftResult = await pool.query(
    "SELECT * FROM daily_shifts WHERE date = $1 AND shift_id = $2 AND is_published = true",
    [today, shiftId]
  );
  const dailyShift = dailyShiftResult.rows[0];

  if (!dailyShift) {
    return void res.render("noTasks", {
      employeeName: req.session.employeeName,
    });
  }

  // Get tasks for this daily shift
  const tasksResult = await pool.query(`
    SELECT dst.id, dst.task_id, dst.display_order, t.name as task_name
    FROM daily_shift_tasks dst
    JOIN tasks t ON t.id = dst.task_id
    WHERE dst.daily_shift_id = $1
    ORDER BY dst.display_order
  `, [dailyShift.id]);

  const tasks = tasksResult.rows.map((t: { task_name: string }) => ({ text: t.task_name }));

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
