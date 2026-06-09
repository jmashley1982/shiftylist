import { Router } from "express";
import db, { type Employee, type ShiftTemplate, type ShiftAssignment } from "../db/index.js";
import { ensureAdminAuth } from "../middleware/auth.js";
import { getUpcomingDays, getTodayStr, formatDateDisplay } from "../utils/dateHelpers.js";
import { getSubmissionsLast30Days } from "../utils/sheets.js";

const router = Router();
router.use(ensureAdminAuth);

router.get("/dashboard", (_req, res) => {
  const employeeCount = (db.prepare("SELECT COUNT(*) as count FROM employees").get() as { count: number }).count;
  const shiftNames = (db.prepare("SELECT DISTINCT shift_name FROM shift_templates").all() as { shift_name: string }[]).map(r => r.shift_name);
  const today = getTodayStr();
  const upcomingCount = (db.prepare(
    "SELECT COUNT(*) as count FROM shift_assignments WHERE date >= ?"
  ).get(today) as { count: number }).count;
  res.render("admin/dashboard", { employeeCount, shiftNames, upcomingCount });
});

// ── Employees ────────────────────────────────────────────────────────────────

router.get("/employees", (_req, res) => {
  const employees = db.prepare("SELECT * FROM employees ORDER BY name").all() as Employee[];
  res.render("admin/employees", { employees, error: null });
});

router.post("/employees/add", (req, res) => {
  const { name, code } = req.body as { name: string; code: string };
  if (!name || !code) return void res.redirect("/admin/employees");
  if (!/^\d{4}$/.test(code)) {
    const employees = db.prepare("SELECT * FROM employees ORDER BY name").all() as Employee[];
    return void res.render("admin/employees", { employees, error: "Code must be exactly 4 digits." });
  }
  try {
    db.prepare("INSERT INTO employees (name, code) VALUES (?, ?)").run(name.trim(), code);
    res.redirect("/admin/employees");
  } catch {
    const employees = db.prepare("SELECT * FROM employees ORDER BY name").all() as Employee[];
    res.render("admin/employees", { employees, error: "That code is already in use." });
  }
});

router.post("/employees/delete/:id", (req, res) => {
  db.prepare("DELETE FROM employees WHERE id = ?").run(Number(req.params.id));
  res.redirect("/admin/employees");
});

// ── Shift templates ──────────────────────────────────────────────────────────

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

// ── Shift Calendar (Schedule) ────────────────────────────────────────────────

router.get("/schedule", (_req, res) => {
  const employees = db.prepare("SELECT id, name FROM employees ORDER BY name").all() as Employee[];
  const shiftNames = (db.prepare("SELECT DISTINCT shift_name FROM shift_templates ORDER BY shift_name").all() as { shift_name: string }[]).map(r => r.shift_name);
  const today = getTodayStr();
  const days = getUpcomingDays(28);
  const maxDate = days[days.length - 1];

  const assignments = db.prepare(`
    SELECT sa.id, sa.employee_id, sa.date, sa.shift_name, e.name as employee_name
    FROM shift_assignments sa
    JOIN employees e ON e.id = sa.employee_id
    WHERE sa.date >= ? AND sa.date <= ?
    ORDER BY sa.date, e.name
  `).all(today, maxDate) as ShiftAssignment[];

  const byDate: Record<string, ShiftAssignment[]> = {};
  for (const a of assignments) {
    if (!byDate[a.date]) byDate[a.date] = [];
    byDate[a.date].push(a);
  }

  const dayObjects = days.map(date => ({
    date,
    label: formatDateDisplay(date),
    isToday: date === today,
    assignments: byDate[date] ?? [],
  }));

  res.render("admin/schedule", { employees, shiftNames, dayObjects, today, maxDate });
});

router.post("/schedule/add", (req, res) => {
  const { employee_id, date, shift_name } = req.body as { employee_id: string; date: string; shift_name: string };
  if (employee_id && date && shift_name) {
    db.prepare(
      "INSERT OR REPLACE INTO shift_assignments (employee_id, date, shift_name) VALUES (?, ?, ?)"
    ).run(Number(employee_id), date, shift_name);
  }
  res.redirect("/admin/schedule");
});

router.post("/schedule/delete/:id", (req, res) => {
  db.prepare("DELETE FROM shift_assignments WHERE id = ?").run(Number(req.params.id));
  res.redirect("/admin/schedule");
});

// ── Reports ──────────────────────────────────────────────────────────────────

router.get("/reports", async (_req, res) => {
  const submissions = await getSubmissionsLast30Days();
  res.render("admin/reports", { submissions });
});

export default router;
