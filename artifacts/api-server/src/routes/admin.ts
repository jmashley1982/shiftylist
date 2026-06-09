import { Router } from "express";
import db, { type Employee, type ShiftTemplate, type ScheduledTask } from "../db/index.js";
import { ensureAdminAuth } from "../middleware/auth.js";
import { getNext14Days, getTodayStr, formatDateDisplay } from "../utils/dateHelpers.js";
import { getSubmissionsLast30Days } from "../utils/sheets.js";

const router = Router();
router.use(ensureAdminAuth);

router.get("/dashboard", (_req, res) => {
  const employeeCount = (db.prepare("SELECT COUNT(*) as count FROM employees").get() as { count: number }).count;
  const shiftNames = (db.prepare("SELECT DISTINCT shift_name FROM shift_templates").all() as { shift_name: string }[]).map(r => r.shift_name);
  const upcomingCount = (db.prepare("SELECT COUNT(*) as count FROM scheduled_tasks WHERE target_date >= ?").get(getTodayStr()) as { count: number }).count;
  res.render("admin/dashboard", { employeeCount, shiftNames, upcomingCount });
});

router.get("/employees", (_req, res) => {
  const employees = db.prepare("SELECT * FROM employees ORDER BY name").all() as Employee[];
  const shiftNames = (db.prepare("SELECT DISTINCT shift_name FROM shift_templates").all() as { shift_name: string }[]).map(r => r.shift_name);
  res.render("admin/employees", { employees, shiftNames, success: null, error: null });
});

router.post("/employees/add", (req, res) => {
  const { name, code, shift_name } = req.body as { name: string; code: string; shift_name: string };
  if (!name || !code || !shift_name) return void res.redirect("/admin/employees");
  if (!/^\d{4}$/.test(code)) {
    const employees = db.prepare("SELECT * FROM employees ORDER BY name").all() as Employee[];
    const shiftNames = (db.prepare("SELECT DISTINCT shift_name FROM shift_templates").all() as { shift_name: string }[]).map(r => r.shift_name);
    return void res.render("admin/employees", { employees, shiftNames, error: "Code must be exactly 4 digits.", success: null });
  }
  try {
    db.prepare("INSERT INTO employees (name, code, shift_name) VALUES (?, ?, ?)").run(name.trim(), code, shift_name);
    res.redirect("/admin/employees");
  } catch {
    const employees = db.prepare("SELECT * FROM employees ORDER BY name").all() as Employee[];
    const shiftNames = (db.prepare("SELECT DISTINCT shift_name FROM shift_templates").all() as { shift_name: string }[]).map(r => r.shift_name);
    res.render("admin/employees", { employees, shiftNames, error: "That code is already in use.", success: null });
  }
});

router.post("/employees/delete/:id", (req, res) => {
  db.prepare("DELETE FROM employees WHERE id = ?").run(Number(req.params.id));
  res.redirect("/admin/employees");
});

router.get("/shifts", (_req, res) => {
  const allTasks = db.prepare("SELECT * FROM shift_templates ORDER BY shift_name, display_order").all() as ShiftTemplate[];
  const shiftNames = [...new Set(allTasks.map(t => t.shift_name))];
  const tasksByShift: Record<string, ShiftTemplate[]> = {};
  for (const name of shiftNames) tasksByShift[name] = allTasks.filter(t => t.shift_name === name);
  res.render("admin/shifts", { tasksByShift, shiftNames, error: null });
});

router.post("/shifts/add-shift", (req, res) => {
  const { shift_name } = req.body as { shift_name: string };
  if (shift_name?.trim()) {
    const exists = db.prepare("SELECT 1 FROM shift_templates WHERE shift_name = ?").get(shift_name.trim());
    if (!exists) {
      db.prepare("INSERT INTO shift_templates (shift_name, task_text, display_order) VALUES (?, ?, ?)").run(shift_name.trim(), "Default task", 0);
    }
  }
  res.redirect("/admin/shifts");
});

router.post("/shifts/add-task", (req, res) => {
  const { shift_name, task_text, display_order } = req.body as { shift_name: string; task_text: string; display_order: string };
  if (shift_name && task_text?.trim()) {
    db.prepare("INSERT INTO shift_templates (shift_name, task_text, display_order) VALUES (?, ?, ?)").run(
      shift_name, task_text.trim(), Number(display_order) || 0
    );
  }
  res.redirect("/admin/shifts");
});

router.post("/shifts/delete-task/:id", (req, res) => {
  db.prepare("DELETE FROM shift_templates WHERE id = ?").run(Number(req.params.id));
  res.redirect("/admin/shifts");
});

router.get("/schedule", (_req, res) => {
  const employees = db.prepare("SELECT id, name, shift_name FROM employees ORDER BY name").all() as Employee[];
  const futureDates = getNext14Days();
  const scheduled = db.prepare(`
    SELECT st.*, e.name as employee_name, e.shift_name
    FROM scheduled_tasks st
    JOIN employees e ON e.id = st.employee_id
    WHERE st.target_date >= ?
    ORDER BY st.target_date, e.name
  `).all(getTodayStr()) as ScheduledTask[];
  res.render("admin/schedule", { employees, futureDates, scheduled, today: getTodayStr(), formatDateDisplay });
});

router.post("/schedule/add", (req, res) => {
  const { employee_id, target_date, task_text } = req.body as { employee_id: string; target_date: string; task_text: string };
  if (employee_id && target_date && task_text?.trim()) {
    db.prepare("INSERT INTO scheduled_tasks (employee_id, target_date, task_text) VALUES (?, ?, ?)").run(
      Number(employee_id), target_date, task_text.trim()
    );
  }
  res.redirect("/admin/schedule");
});

router.post("/schedule/delete/:id", (req, res) => {
  db.prepare("DELETE FROM scheduled_tasks WHERE id = ?").run(Number(req.params.id));
  res.redirect("/admin/schedule");
});

router.get("/reports", async (_req, res) => {
  const submissions = await getSubmissionsLast30Days();
  res.render("admin/reports", { submissions });
});

export default router;
