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

  const empResult = await pool.query(
    "SELECT * FROM employees WHERE id = $1",
    [empId]
  );
  const employee = empResult.rows[0];

  let shiftName = req.session.employeeShift;
  if (!shiftName) {
    const assignResult = await pool.query(
      "SELECT shift_name FROM shift_assignments WHERE employee_id = $1 AND date = $2",
      [empId, today]
    );
    shiftName = assignResult.rows[0]?.shift_name;
  }

  if (!shiftName) {
    const todaysResult = await pool.query(`
      SELECT sa.id, sa.employee_id, sa.shift_name, e.name as employee_name
      FROM shift_assignments sa
      JOIN employees e ON e.id = sa.employee_id
      WHERE sa.date = $1 AND sa.employee_id != $2
      ORDER BY e.name
    `, [today, empId]);
    return void res.render("noTasks", {
      employeeName: req.session.employeeName,
      todaysAssignments: todaysResult.rows,
    });
  }

  const tasksResult = await pool.query(
    "SELECT task_text FROM shift_templates WHERE shift_name = $1 ORDER BY display_order",
    [shiftName]
  );

  const schedResult = await pool.query(
    "SELECT task_text FROM scheduled_tasks WHERE employee_id = $1 AND target_date = $2",
    [empId, today]
  );

  const allTasks = [
    ...tasksResult.rows.map((t: { task_text: string }) => ({ text: t.task_text })),
    ...schedResult.rows.map((t: { task_text: string }) => ({ text: t.task_text })),
  ];

  if (allTasks.length === 0) {
    const todaysResult = await pool.query(`
      SELECT sa.id, sa.employee_id, sa.shift_name, e.name as employee_name
      FROM shift_assignments sa
      JOIN employees e ON e.id = sa.employee_id
      WHERE sa.date = $1 AND sa.employee_id != $2
      ORDER BY e.name
    `, [today, empId]);
    return void res.render("noTasks", {
      employeeName: req.session.employeeName,
      todaysAssignments: todaysResult.rows,
    });
  }

  res.render("todolist", {
    tasks: allTasks,
    employeeName: req.session.employeeName,
    shift: shiftName,
    coveringFor: req.session.employeeShift ? shiftName : null,
  });
});

router.post("/submit", ensureStaffAuth, async (req, res) => {
  interface TaskEntry {
    text: string;
    completed: boolean;
    completionTime: string | null;
  }
  let tasks: TaskEntry[] = [];
  try {
    const raw = req.body as { tasks?: string };
    tasks = JSON.parse(raw.tasks ?? "[]") as TaskEntry[];
  } catch {
    return void res.status(400).send("Invalid task data");
  }

  const submission = {
    timestamp: new Date().toISOString(),
    userCode: req.session.employeeCode ?? "",
    employeeName: req.session.employeeName ?? "",
    shift: req.session.employeeShift ?? "",
    date: getTodayStr(),
    tasks,
  };

  try {
    await appendToSheet(submission);
    req.session.employeeShift = undefined;
    res.render("submitted", {
      employeeName: req.session.employeeName,
      shift: submission.shift,
      date: submission.date,
      tasks,
    });
  } catch (err) {
    logger.error({ err }, "Submit failed");
    res.status(500).render("error", {
      message: "Failed to submit report to Google Sheets. Please contact your manager.",
    });
  }
});

router.post("/cover", ensureStaffAuth, async (req, res) => {
  const { targetEmployeeId } = req.body as { targetEmployeeId: string };
  const today = getTodayStr();
  const result = await pool.query(
    "SELECT shift_name FROM shift_assignments WHERE employee_id = $1 AND date = $2",
    [Number(targetEmployeeId), today]
  );
  const assignment = result.rows[0];
  if (!assignment) {
    return void res.status(400).send("That employee has no shift assigned today.");
  }
  req.session.employeeShift = assignment.shift_name;
  res.redirect("/staff/tasks");
});

export default router;
