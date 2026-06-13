import { Router } from "express";
import type { PoolClient } from "pg";
import { pool } from "../db/index.js";
import { ensureAdminAuth } from "../middleware/auth.js";
import { getTodayStr, formatDateDisplay } from "../utils/dateHelpers.js";
import { getSubmissionsLast30Days } from "../utils/sheets.js";

const router = Router();
router.use(ensureAdminAuth);

// ════════════════════════════════════ Helpers ═══════════════════════════════════
function getOffsetDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

/** Run fn inside a BEGIN/COMMIT transaction; rolls back on error. */
async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Create the task by name if new, otherwise reuse the existing one. Returns its id. */
async function upsertTaskByName(client: PoolClient, name: string): Promise<number> {
  const res = await client.query(
    `INSERT INTO tasks (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [name]
  );
  return res.rows[0].id as number;
}

/** Build the redirect URL back to the shifts hub, preserving shift + optional day. */
function hubUrl(shiftId: number | string, date?: string): string {
  const base = `/admin/shifts?shift=${shiftId}`;
  return date ? `${base}&date=${date}` : base;
}

/**
 * Renormalize a list of task rows to display_order 0, 1, 2, … in a single
 * UPDATE … FROM (VALUES …) statement. A single-statement update allows
 * PostgreSQL to resolve temporary intra-statement uniqueness conflicts, so
 * the (shift_id/daily_shift_id, display_order) unique constraint is never
 * violated even during a reorder.
 */
async function bulkRenormalizeOrder(
  client: PoolClient,
  table: "shift_tasks",
  ids: number[]
): Promise<void> {
  if (ids.length === 0) return;
  const valuePlaceholders = ids.map((_, i) => `($${i * 2 + 1}::int, $${i * 2 + 2}::int)`).join(", ");
  const params: number[] = ids.flatMap((id, i) => [id, i]);
  await client.query(
    `UPDATE ${table} AS t
     SET display_order = vals.new_order
     FROM (VALUES ${valuePlaceholders}) AS vals(row_id, new_order)
     WHERE t.id = vals.row_id`,
    params
  );
}

// ════════════════════════════════════ Dashboard ═════════════════════════════════
router.get("/dashboard", async (_req, res) => {
  const empCount = (await pool.query("SELECT COUNT(*) as count FROM employees")).rows[0].count;
  const shiftCount = (await pool.query("SELECT COUNT(*) as count FROM shifts")).rows[0].count;
  const taskCount = (await pool.query("SELECT COUNT(*) as count FROM tasks")).rows[0].count;
  const today = getTodayStr();
  const extraCount = (await pool.query(
    "SELECT COUNT(*) as count FROM extra_day_tasks WHERE date >= $1",
    [today]
  )).rows[0].count;
  res.render("admin/dashboard", { employeeCount: empCount, shiftCount, taskCount, customCount: extraCount, today });
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

// ════════════════════════════════════ Shifts hub ════════════════════════════════
// One screen to build a shift's standing checklist (always live) and optionally
// add extra tasks for a specific day.
router.get("/shifts", async (req, res) => {
  const shifts = (await pool.query("SELECT * FROM shifts ORDER BY id")).rows;

  const requestedShift = Number(req.query.shift);
  const selectedShift =
    shifts.find((s: { id: number }) => s.id === requestedShift) || shifts[0] || null;

  // Autocomplete suggestions from the reusable task library.
  const allTasks = (await pool.query("SELECT * FROM tasks ORDER BY name")).rows;

  // Standing list for the selected shift.
  let standingTasks: { id: number; task_name: string; display_order: number }[] = [];
  if (selectedShift) {
    standingTasks = (await pool.query(
      `SELECT st.id, st.display_order, t.name as task_name
       FROM shift_tasks st
       JOIN tasks t ON t.id = st.task_id
       WHERE st.shift_id = $1
       ORDER BY st.display_order`,
      [selectedShift.id]
    )).rows;
  }

  // Day mode (optional): adding extra tasks for a specific date.
  const rawDate = req.query.date as string | undefined;
  const dayMode = !!rawDate;
  const date = rawDate || getTodayStr();
  let extraTasks: { id: number; task_name: string; display_order: number }[] = [];

  if (selectedShift && dayMode) {
    extraTasks = (await pool.query(
      `SELECT id, task_name, display_order
       FROM extra_day_tasks
       WHERE shift_id = $1 AND date = $2
       ORDER BY display_order`,
      [selectedShift.id, date]
    )).rows;
  }

  res.render("admin/shifts", {
    shifts,
    selectedShift,
    allTasks,
    standingTasks,
    dayMode,
    date,
    today: getTodayStr(),
    prevDate: getOffsetDate(date, -1),
    nextDate: getOffsetDate(date, 1),
    extraTasks,
    formatDateDisplay,
  });
});

// ── Shift types ──────────────────────────────────────────────────────────────
router.post("/shifts/add", async (req, res) => {
  const { name } = req.body as { name: string };
  if (name?.trim()) {
    const r = await pool.query(
      "INSERT INTO shifts (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING id",
      [name.trim()]
    );
    if (r.rows[0]) return void res.redirect(hubUrl(r.rows[0].id));
  }
  res.redirect("/admin/shifts");
});

router.post("/shifts/delete/:id", async (req, res) => {
  await pool.query("DELETE FROM shifts WHERE id = $1", [Number(req.params.id)]);
  res.redirect("/admin/shifts");
});

// ── Standing list (always live) ──────────────────────────────────────────────
router.post("/shifts/:shiftId/standing/add", async (req, res) => {
  const shiftId = Number(req.params.shiftId);
  const name = (req.body.name as string)?.trim();
  if (name) {
    await withTransaction(async (client) => {
      await client.query("SELECT id FROM shifts WHERE id = $1 FOR UPDATE", [shiftId]);

      const taskId = await upsertTaskByName(client, name);
      const maxRow = (await client.query(
        "SELECT COALESCE(MAX(display_order), -1) as max FROM shift_tasks WHERE shift_id = $1",
        [shiftId]
      )).rows[0];
      await client.query(
        `INSERT INTO shift_tasks (shift_id, task_id, display_order) VALUES ($1, $2, $3)
         ON CONFLICT (shift_id, task_id) DO NOTHING`,
        [shiftId, taskId, (maxRow.max as number) + 1]
      );
    });
  }
  res.redirect(hubUrl(shiftId));
});

router.post("/shifts/:shiftId/standing/remove/:id", async (req, res) => {
  await pool.query("DELETE FROM shift_tasks WHERE id = $1", [Number(req.params.id)]);
  res.redirect(hubUrl(req.params.shiftId));
});

router.post("/shifts/:shiftId/standing/rename/:id", async (req, res) => {
  const shiftTaskId = Number(req.params.id);
  const shiftId = Number(req.params.shiftId);
  const name = (req.body.name as string)?.trim();
  if (!name) return void res.json({ ok: false, error: "Name required" });
  await withTransaction(async (client) => {
    const taskId = await upsertTaskByName(client, name);
    await client.query(
      "UPDATE shift_tasks SET task_id = $1 WHERE id = $2 AND shift_id = $3",
      [taskId, shiftTaskId, shiftId]
    );
  });
  res.json({ ok: true });
});

router.post("/shifts/:shiftId/standing/reorder", async (req, res) => {
  const shiftId = Number(req.params.shiftId);
  const ids = (req.body.ids as unknown[]);
  if (!Array.isArray(ids) || ids.length === 0) return void res.json({ ok: false });
  const idArray = ids.map(Number).filter(n => n > 0);
  await withTransaction(async (client) => {
    await client.query("SELECT id FROM shifts WHERE id = $1 FOR UPDATE", [shiftId]);
    await bulkRenormalizeOrder(client, "shift_tasks", idArray);
  });
  res.json({ ok: true });
});

router.post("/shifts/:shiftId/standing/move/:id", async (req, res) => {
  const id = Number(req.params.id);
  const shiftId = Number(req.params.shiftId);
  const direction = req.body.direction as "up" | "down";

  await withTransaction(async (client) => {
    const rows = (await client.query(
      "SELECT id FROM shift_tasks WHERE shift_id = $1 ORDER BY display_order FOR UPDATE",
      [shiftId]
    )).rows as { id: number }[];

    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= rows.length) return;

    [rows[idx], rows[swapIdx]] = [rows[swapIdx], rows[idx]];

    await bulkRenormalizeOrder(client, "shift_tasks", rows.map((r) => r.id));
  });

  res.redirect(hubUrl(shiftId));
});

// ── Extra tasks for a specific day ──────────────────────────────────────────
router.post("/shifts/:shiftId/day/:date/add-extra", async (req, res) => {
  const shiftId = Number(req.params.shiftId);
  const { date } = req.params;
  const name = (req.body.name as string)?.trim();

  if (name) {
    const maxRow = (await pool.query(
      "SELECT COALESCE(MAX(display_order), -1) as max FROM extra_day_tasks WHERE shift_id = $1 AND date = $2",
      [shiftId, date]
    )).rows[0];
    await pool.query(
      "INSERT INTO extra_day_tasks (shift_id, date, task_name, display_order) VALUES ($1, $2, $3, $4)",
      [shiftId, date, name, (maxRow.max as number) + 1]
    );
  }

  res.redirect(hubUrl(shiftId, date));
});

router.post("/shifts/:shiftId/day/:date/remove-extra/:id", async (req, res) => {
  await pool.query("DELETE FROM extra_day_tasks WHERE id = $1", [Number(req.params.id)]);
  res.redirect(hubUrl(req.params.shiftId, req.params.date));
});

// ════════════════════════════════════ Reports ═════════════════════════════════
router.get("/reports", async (_req, res) => {
  const submissions = await getSubmissionsLast30Days();
  res.render("admin/reports", { submissions });
});

export default router;
