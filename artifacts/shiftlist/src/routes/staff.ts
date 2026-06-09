import { Router } from "express";
import db, { type Employee, type ShiftTemplate, type ScheduledTask } from "../db/index.js";
import { ensureStaffAuth } from "../middleware/auth.js";
import { getTodayStr } from "../utils/dateHelpers.js";
import { appendToSheet } from "../utils/sheets.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.get("/tasks", ensureStaffAuth, (req, res) => {
  const empId = req.session.employeeId!;
  const today = getTodayStr();

  const employee = db
    .prepare("SELECT * FROM employees WHERE id = ?")
    .get(empId) as Employee;

  // Session override means covering someone else's shift; otherwise look up today's assignment
  let shiftName = req.session.employeeShift;
  if (!shiftName) {
    const assignment = db
      .prepare("SELECT shift_name FROM shift_assignments WHERE employee_id = ? AND date = ?")
      .get(empId, today) as { shift_name: string } | undefined;
    shiftName = assignment?.shift_name;
  }

  if (!shiftName) {
    // Not scheduled today — offer cover option
    const todaysAssignments = db.prepare(`
      SELECT sa.id, sa.employee_id, sa.shift_name, e.name as employee_name
      FROM shift_assignments sa
      JOIN employees e ON e.id = sa.employee_id
      WHERE sa.date = ? AND sa.employee_id != ?
      ORDER BY e.name
    `).all(today, empId) as Array<{ id: number; employee_id: number; shift_name: string; employee_name: string }>;
    return void res.render("noTasks", {
      employeeName: req.session.employeeName,
      todaysAssignments,
    });
  }

  const shiftTasks = db
    .prepare("SELECT task_text FROM shift_templates WHERE shift_name = ? ORDER BY display_order")
    .all(shiftName) as Pick<ShiftTemplate, "task_text">[];

  const scheduled = db
    .prepare("SELECT task_text FROM scheduled_tasks WHERE employee_id = ? AND target_date = ?")
    .all(empId, today) as Pick<ScheduledTask, "task_text">[];

  const allTasks = [
    ...shiftTasks.map(t => ({ text: t.task_text })),
    ...scheduled.map(t => ({ text: t.task_text })),
  ];

  if (allTasks.length === 0) {
    const todaysAssignments = db.prepare(`
      SELECT sa.id, sa.employee_id, sa.shift_name, e.name as employee_name
      FROM shift_assignments sa
      JOIN employees e ON e.id = sa.employee_id
      WHERE sa.date = ? AND sa.employee_id != ?
      ORDER BY e.name
    `).all(today, empId) as Array<{ id: number; employee_id: number; shift_name: string; employee_name: string }>;
    return void res.render("noTasks", {
      employeeName: req.session.employeeName,
      todaysAssignments,
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

router.post("/cover", ensureStaffAuth, (req, res) => {
  const { targetEmployeeId } = req.body as { targetEmployeeId: string };
  const today = getTodayStr();
  const assignment = db
    .prepare("SELECT shift_name FROM shift_assignments WHERE employee_id = ? AND date = ?")
    .get(Number(targetEmployeeId), today) as { shift_name: string } | undefined;
  if (!assignment) {
    return void res.status(400).send("That employee has no shift assigned today.");
  }
  req.session.employeeShift = assignment.shift_name;
  res.redirect("/staff/tasks");
});

export default router;
