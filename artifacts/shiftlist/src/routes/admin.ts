import { Router } from "express";
import { pool } from "../db/index.js";
import { ensureAdminAuth } from "../middleware/auth.js";
import { getTodayStr, formatDateDisplay } from "../utils/dateHelpers.js";
import { getSubmissionsLast30Days } from "../utils/sheets.js";

const router = Router();
router.use(ensureAdminAuth);

// ════════════════════════════════════ Dashboard ═════════════════════════════════
router.get("/dashboard", async (_req, res) => {
  const empCount = (await pool.query("SELECT COUNT(*) as count FROM employees")).rows[0].count;
  const shiftCount = (await pool.query("SELECT COUNT(*) as count FROM shifts")).rows[0].count;
  const taskCount = (await pool.query("SELECT COUNT(*) as count FROM tasks")).rows[0].count;
  const today = getTodayStr();
  const publishedCount = (await pool.query(
    "SELECT COUNT(*) as count FROM daily_shifts WHERE date = $1 AND is_published = true",
    [today]
  )).rows[0].count;
  res.render("admin/dashboard", { employeeCount: empCount, shiftCount, taskCount, publishedCount, today });
});

// ════════════════════════════════════ Employees ════════════════════════════════
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

// ════════════════════════════════════ Tasks ════════════════════════════════════
router.get("/tasks", async (_req, res) => {
  const tasks = (await pool.query("SELECT * FROM tasks ORDER BY name")).rows;
  res.render("admin/tasks", { tasks, error: null });
});

router.post("/tasks/add", async (req, res) => {
  const { name } = req.body as { name: string };
  if (!name?.trim()) return void res.redirect("/admin/tasks");
  try {
    await pool.query("INSERT INTO tasks (name) VALUES ($1)", [name.trim()]);
  } catch {
    // duplicate
  }
  res.redirect("/admin/tasks");
});

router.post("/tasks/edit/:id", async (req, res) => {
  const { name } = req.body as { name: string };
  if (name?.trim()) {
    await pool.query("UPDATE tasks SET name = $1 WHERE id = $2", [name.trim(), Number(req.params.id)]);
  }
  res.redirect("/admin/tasks");
});

router.post("/tasks/delete/:id", async (req, res) => {
  await pool.query("DELETE FROM tasks WHERE id = $1", [Number(req.params.id)]);
  res.redirect("/admin/tasks");
});

// ════════════════════════════════════ Shifts ═══════════════════════════════════
router.get("/shifts", async (_req, res) => {
  const shifts = (await pool.query("SELECT * FROM shifts ORDER BY name")).rows;
  const tasks = (await pool.query("SELECT * FROM tasks ORDER BY name")).rows;
  const shiftTasks = (await pool.query(`
    SELECT st.id, st.shift_id, st.task_id, st.display_order, t.name as task_name
    FROM shift_tasks st
    JOIN tasks t ON t.id = st.task_id
    ORDER BY st.shift_id, st.display_order
  `)).rows;
  res.render("admin/shifts", { shifts, tasks, shiftTasks });
});

router.post("/shifts/add", async (req, res) => {
  const { name } = req.body as { name: string };
  if (name?.trim()) {
    await pool.query("INSERT INTO shifts (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [name.trim()]);
  }
  res.redirect("/admin/shifts");
});

router.post("/shifts/delete/:id", async (req, res) => {
  await pool.query("DELETE FROM shifts WHERE id = $1", [Number(req.params.id)]);
  res.redirect("/admin/shifts");
});

router.post("/shifts/:shiftId/add-task", async (req, res) => {
  const shiftId = Number(req.params.shiftId);
  const taskId = Number(req.body.taskId);
  const maxOrder = (await pool.query(
    "SELECT COALESCE(MAX(display_order), -1) as max FROM shift_tasks WHERE shift_id = $1",
    [shiftId]
  )).rows[0].max;
  await pool.query(
    "INSERT INTO shift_tasks (shift_id, task_id, display_order) VALUES ($1, $2, $3) ON CONFLICT (shift_id, task_id) DO NOTHING",
    [shiftId, taskId, maxOrder + 1]
  );
  res.redirect("/admin/shifts");
});

router.post("/shifts/:shiftId/remove-task/:id", async (req, res) => {
  await pool.query("DELETE FROM shift_tasks WHERE id = $1", [Number(req.params.id)]);
  res.redirect("/admin/shifts");
});

router.post("/shifts/:shiftId/move-task/:id", async (req, res) => {
  const id = Number(req.params.id);
  const shiftId = Number(req.params.shiftId);
  const direction = req.body.direction as "up" | "down";
  const rows = (await pool.query(
    "SELECT id, display_order FROM shift_tasks WHERE shift_id = $1 ORDER BY display_order",
    [shiftId]
  )).rows;
  const idx = rows.findIndex((r: { id: number }) => r.id === id);
  if (idx === -1) return void res.redirect("/admin/shifts");
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= rows.length) return void res.redirect("/admin/shifts");
  const currentOrder = rows[idx].display_order;
  const swapOrder = rows[swapIdx].display_order;
  await pool.query("UPDATE shift_tasks SET display_order = $1 WHERE id = $2", [swapOrder, rows[idx].id]);
  await pool.query("UPDATE shift_tasks SET display_order = $1 WHERE id = $2", [currentOrder, rows[swapIdx].id]);
  res.redirect("/admin/shifts");
});

// ════════════════════════════════════ Schedule ══════════════════════════════════
router.get("/schedule", async (req, res) => {
  const date = (req.query.date as string) || getTodayStr();
  const shifts = (await pool.query("SELECT * FROM shifts ORDER BY name")).rows;
  const tasks = (await pool.query("SELECT * FROM tasks ORDER BY name")).rows;

  // Get daily shifts for this date
  const dailyShifts = (await pool.query(
    "SELECT * FROM daily_shifts WHERE date = $1 ORDER BY shift_id",
    [date]
  )).rows;
  const dailyShiftMap = Object.fromEntries(dailyShifts.map((ds: { shift_id: number }) => [ds.shift_id, ds]));

  // Get daily shift tasks for this date
  const dailyShiftTasks = (await pool.query(`
    SELECT dst.id, dst.daily_shift_id, dst.task_id, dst.display_order, t.name as task_name, ds.shift_id
    FROM daily_shift_tasks dst
    JOIN daily_shifts ds ON ds.id = dst.daily_shift_id
    JOIN tasks t ON t.id = dst.task_id
    WHERE ds.date = $1
    ORDER BY ds.shift_id, dst.display_order
  `, [date])).rows;

  const dailyTasksByShift: Record<number, typeof dailyShiftTasks> = {};
  for (const s of shifts) dailyTasksByShift[s.id] = [];
  for (const t of dailyShiftTasks) {
    if (!dailyTasksByShift[t.shift_id]) dailyTasksByShift[t.shift_id] = [];
    dailyTasksByShift[t.shift_id].push(t);
  }

  // Get template tasks for each shift (for pre-populate)
  const templateTasks = (await pool.query(`
    SELECT st.shift_id, st.task_id, st.display_order, t.name as task_name
    FROM shift_tasks st
    JOIN tasks t ON t.id = st.task_id
    ORDER BY st.shift_id, st.display_order
  `)).rows;
  const templateTasksByShift: Record<number, typeof templateTasks> = {};
  for (const s of shifts) templateTasksByShift[s.id] = [];
  for (const t of templateTasks) {
    if (!templateTasksByShift[t.shift_id]) templateTasksByShift[t.shift_id] = [];
    templateTasksByShift[t.shift_id].push(t);
  }

  res.render("admin/schedule", {
    shifts,
    tasks,
    date,
    prevDate: getOffsetDate(date, -1),
    nextDate: getOffsetDate(date, 1),
    today: getTodayStr(),
    dailyShiftMap,
    dailyTasksByShift,
    templateTasksByShift,
    formatDateDisplay,
  });
});

function getOffsetDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

router.post("/schedule/:date/:shiftId/publish", async (req, res) => {
  const { date, shiftId } = req.params;
  const dsResult = await pool.query(
    `INSERT INTO daily_shifts (date, shift_id, is_published) VALUES ($1, $2, true)
     ON CONFLICT (date, shift_id) DO UPDATE SET is_published = true RETURNING id`,
    [date, Number(shiftId)]
  );
  const dailyShiftId = dsResult.rows[0].id;
  // Copy template tasks if no daily tasks exist yet
  const existing = (await pool.query(
    "SELECT COUNT(*) as count FROM daily_shift_tasks WHERE daily_shift_id = $1",
    [dailyShiftId]
  )).rows[0].count;
  if (existing === 0) {
    const template = (await pool.query(
      "SELECT task_id, display_order FROM shift_tasks WHERE shift_id = $1 ORDER BY display_order",
      [Number(shiftId)]
    )).rows;
    for (const t of template) {
      await pool.query(
        `INSERT INTO daily_shift_tasks (daily_shift_id, task_id, display_order) VALUES ($1, $2, $3)
         ON CONFLICT (daily_shift_id, task_id) DO NOTHING`,
        [dailyShiftId, t.task_id, t.display_order]
      );
    }
  }
  res.redirect(`/admin/schedule?date=${date}`);
});

router.post("/schedule/:date/:shiftId/unpublish", async (req, res) => {
  await pool.query(
    "UPDATE daily_shifts SET is_published = false WHERE date = $1 AND shift_id = $2",
    [req.params.date, Number(req.params.shiftId)]
  );
  res.redirect(`/admin/schedule?date=${req.params.date}`);
});

router.post("/schedule/:date/:shiftId/copy-template", async (req, res) => {
  const { date, shiftId } = req.params;
  const dsResult = await pool.query(
    `INSERT INTO daily_shifts (date, shift_id, is_published) VALUES ($1, $2, true)
     ON CONFLICT (date, shift_id) DO UPDATE SET is_published = true RETURNING id`,
    [date, Number(shiftId)]
  );
  const dailyShiftId = dsResult.rows[0].id;
  // Remove existing daily tasks
  await pool.query("DELETE FROM daily_shift_tasks WHERE daily_shift_id = $1", [dailyShiftId]);
  // Copy template tasks
  const template = (await pool.query(
    "SELECT task_id, display_order FROM shift_tasks WHERE shift_id = $1 ORDER BY display_order",
    [Number(shiftId)]
  )).rows;
  for (const t of template) {
    await pool.query(
      `INSERT INTO daily_shift_tasks (daily_shift_id, task_id, display_order) VALUES ($1, $2, $3)
       ON CONFLICT (daily_shift_id, task_id) DO NOTHING`,
      [dailyShiftId, t.task_id, t.display_order]
    );
  }
  res.redirect(`/admin/schedule?date=${date}`);
});

router.post("/schedule/:date/:shiftId/add-task", async (req, res) => {
  const { date, shiftId } = req.params;
  const taskId = Number(req.body.taskId);
  // Ensure daily shift exists
  const dsResult = await pool.query(
    `INSERT INTO daily_shifts (date, shift_id, is_published) VALUES ($1, $2, false)
     ON CONFLICT (date, shift_id) DO NOTHING RETURNING id`,
    [date, Number(shiftId)]
  );
  let dailyShiftId: number;
  if (dsResult.rows[0]) {
    dailyShiftId = dsResult.rows[0].id;
  } else {
    const existing = await pool.query(
      "SELECT id FROM daily_shifts WHERE date = $1 AND shift_id = $2",
      [date, Number(shiftId)]
    );
    dailyShiftId = existing.rows[0].id;
  }
  const maxOrder = (await pool.query(
    "SELECT COALESCE(MAX(display_order), -1) as max FROM daily_shift_tasks WHERE daily_shift_id = $1",
    [dailyShiftId]
  )).rows[0].max;
  await pool.query(
    `INSERT INTO daily_shift_tasks (daily_shift_id, task_id, display_order) VALUES ($1, $2, $3)
     ON CONFLICT (daily_shift_id, task_id) DO NOTHING`,
    [dailyShiftId, taskId, maxOrder + 1]
  );
  res.redirect(`/admin/schedule?date=${date}`);
});

router.post("/schedule/:date/:shiftId/remove-task/:id", async (req, res) => {
  await pool.query("DELETE FROM daily_shift_tasks WHERE id = $1", [Number(req.params.id)]);
  res.redirect(`/admin/schedule?date=${req.params.date}`);
});

router.post("/schedule/:date/:shiftId/move-task/:id", async (req, res) => {
  const id = Number(req.params.id);
  const dailyShiftId = Number(req.params.shiftId);
  const direction = req.body.direction as "up" | "down";
  const rows = (await pool.query(
    "SELECT id, display_order FROM daily_shift_tasks WHERE daily_shift_id = $1 ORDER BY display_order",
    [dailyShiftId]
  )).rows;
  const idx = rows.findIndex((r: { id: number }) => r.id === id);
  if (idx === -1) return void res.redirect(`/admin/schedule?date=${req.params.date}`);
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= rows.length) return void res.redirect(`/admin/schedule?date=${req.params.date}`);
  const currentOrder = rows[idx].display_order;
  const swapOrder = rows[swapIdx].display_order;
  await pool.query("UPDATE daily_shift_tasks SET display_order = $1 WHERE id = $2", [swapOrder, rows[idx].id]);
  await pool.query("UPDATE daily_shift_tasks SET display_order = $1 WHERE id = $2", [currentOrder, rows[swapIdx].id]);
  res.redirect(`/admin/schedule?date=${req.params.date}`);
});

// ════════════════════════════════════ Reports ═════════════════════════════════
router.get("/reports", async (_req, res) => {
  const submissions = await getSubmissionsLast30Days();
  res.render("admin/reports", { submissions });
});

export default router;
