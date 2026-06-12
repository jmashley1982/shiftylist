import { Router } from "express";
import { pool } from "../db/index.js";
import { ensureAdminAuth } from "../middleware/auth.js";
import { getUpcomingDays, getTodayStr, formatDateDisplay } from "../utils/dateHelpers.js";
import { getSubmissionsLast30Days } from "../utils/sheets.js";

const router = Router();
router.use(ensureAdminAuth);

router.get("/dashboard", async (_req, res) => {
  const empCount = (await pool.query("SELECT COUNT(*) as count FROM employees")).rows[0].count;
  const shiftNames = (await pool.query("SELECT DISTINCT shift_name FROM shift_templates ORDER BY shift_name")).rows.map((r: { shift_name: string }) => r.shift_name);
  const today = getTodayStr();
  const upcomingCount = (await pool.query("SELECT COUNT(*) as count FROM shift_assignments WHERE date >= $1", [today])).rows[0].count;
  res.render("admin/dashboard", { employeeCount: empCount, shiftNames, upcomingCount });
});

// ── Employees ────────────────────────────────────────────────────────────────

router.get("/employees", async (_req, res) => {
  const employees = (await pool.query("SELECT * FROM employees ORDER BY name")).rows;
  res.render("admin/employees", { employees, error: null });
});

router.post("/employees/add", async (req, res) => {
  const { name, code } = req.body as { name: string; code: string };
  if (!name || !code) return void res.redirect("/admin/employees");
  if (!/^\d{4}$/.test(code)) {
    const employees = (await pool.query("SELECT * FROM employees ORDER BY name")).rows;
    return void res.render("admin/employees", { employees, error: "Code must be exactly 4 digits." });
  }
  try {
    await pool.query("INSERT INTO employees (name, code) VALUES ($1, $2)", [name.trim(), code]);
    res.redirect("/admin/employees");
  } catch {
    const employees = (await pool.query("SELECT * FROM employees ORDER BY name")).rows;
    res.render("admin/employees", { employees, error: "That code is already in use." });
  }
});

router.post("/employees/delete/:id", async (req, res) => {
  await pool.query("DELETE FROM employees WHERE id = $1", [Number(req.params.id)]);
  res.redirect("/admin/employees");
});

// ── Shift templates ──────────────────────────────────────────────────────────

router.get("/shifts", async (_req, res) => {
  const allTasks = (await pool.query("SELECT * FROM shift_templates ORDER BY shift_name, display_order")).rows;
  const shiftNames = [...new Set(allTasks.map((t: { shift_name: string }) => t.shift_name))];
  const tasksByShift: Record<string, typeof allTasks> = {};
  for (const name of shiftNames) tasksByShift[name] = allTasks.filter((t: { shift_name: string }) => t.shift_name === name);
  res.render("admin/shifts", { tasksByShift, shiftNames, error: null });
});

router.post("/shifts/add-shift", async (req, res) => {
  const { shift_name } = req.body as { shift_name: string };
  if (shift_name?.trim()) {
    const exists = (await pool.query("SELECT 1 FROM shift_templates WHERE shift_name = $1", [shift_name.trim()])).rows[0];
    if (!exists) {
      await pool.query("INSERT INTO shift_templates (shift_name, task_text, display_order) VALUES ($1, $2, $3)", [shift_name.trim(), "Default task", 0]);
    }
  }
  res.redirect("/admin/shifts");
});

router.post("/shifts/add-task", async (req, res) => {
  const { shift_name, task_text, display_order } = req.body as { shift_name: string; task_text: string; display_order: string };
  if (shift_name && task_text?.trim()) {
    await pool.query("INSERT INTO shift_templates (shift_name, task_text, display_order) VALUES ($1, $2, $3)", [shift_name, task_text.trim(), Number(display_order) || 0]);
  }
  res.redirect("/admin/shifts");
});

router.post("/shifts/delete-task/:id", async (req, res) => {
  await pool.query("DELETE FROM shift_templates WHERE id = $1", [Number(req.params.id)]);
  res.redirect("/admin/shifts");
});

// ── Shift Calendar (Schedule) ────────────────────────────────────────────────

router.get("/schedule", async (_req, res) => {
  const employees = (await pool.query("SELECT id, name FROM employees ORDER BY name")).rows;
  const shiftNames = (await pool.query("SELECT DISTINCT shift_name FROM shift_templates ORDER BY shift_name")).rows.map((r: { shift_name: string }) => r.shift_name);
  const today = getTodayStr();
  const days = getUpcomingDays(28);
  const maxDate = days[days.length - 1];

  const assignments = (await pool.query(`
    SELECT sa.id, sa.employee_id, sa.date, sa.shift_name, e.name as employee_name
    FROM shift_assignments sa
    JOIN employees e ON e.id = sa.employee_id
    WHERE sa.date >= $1 AND sa.date <= $2
    ORDER BY sa.date, e.name
  `, [today, maxDate])).rows;

  const byDate: Record<string, typeof assignments> = {};
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

router.post("/schedule/add", async (req, res) => {
  const { employee_id, date, shift_name } = req.body as { employee_id: string; date: string; shift_name: string };
  if (employee_id && date && shift_name) {
    await pool.query(
      "INSERT INTO shift_assignments (employee_id, date, shift_name) VALUES ($1, $2, $3) ON CONFLICT (employee_id, date) DO UPDATE SET shift_name = EXCLUDED.shift_name",
      [Number(employee_id), date, shift_name]
    );
  }
  res.redirect("/admin/schedule");
});

router.post("/schedule/delete/:id", async (req, res) => {
  await pool.query("DELETE FROM shift_assignments WHERE id = $1", [Number(req.params.id)]);
  res.redirect("/admin/schedule");
});

// ── Reports ──────────────────────────────────────────────────────────────────

router.get("/reports", async (_req, res) => {
  const submissions = await getSubmissionsLast30Days();
  res.render("admin/reports", { submissions });
});

export default router;
