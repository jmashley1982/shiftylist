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

  const shiftName = req.session.employeeShift ?? employee.shift_name;

  const shiftTasks = db
    .prepare(
      "SELECT task_text FROM shift_templates WHERE shift_name = ? ORDER BY display_order"
    )
    .all(shiftName) as Pick<ShiftTemplate, "task_text">[];

  const scheduled = db
    .prepare(
      "SELECT task_text FROM scheduled_tasks WHERE employee_id = ? AND target_date = ?"
    )
    .all(empId, today) as Pick<ScheduledTask, "task_text">[];

  const allTasks = [
    ...shiftTasks.map((t) => ({ text: t.task_text })),
    ...scheduled.map((t) => ({ text: t.task_text })),
  ];

  if (allTasks.length === 0) {
    const employees = db
      .prepare("SELECT id, name, shift_name FROM employees WHERE id != ?")
      .all(empId) as Employee[];
    return void res.render("noTasks", {
      employeeName: req.session.employeeName,
      employees,
    });
  }

  res.render("todolist", {
    tasks: allTasks,
    employeeName: req.session.employeeName,
    shift: shiftName,
    coveringFor: req.session.employeeShift && req.session.employeeShift !== employee.shift_name
      ? req.session.employeeShift
      : null,
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
  const targetEmp = db
    .prepare("SELECT * FROM employees WHERE id = ?")
    .get(Number(targetEmployeeId)) as Employee | undefined;
  if (!targetEmp) {
    return void res.status(400).send("Invalid employee");
  }
  req.session.employeeShift = targetEmp.shift_name;
  res.redirect("/staff/tasks");
});

export default router;
