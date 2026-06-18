import { Router } from "express";
import type { PoolClient } from "pg";
import { pool } from "../db/index.js";
import { ensureAdminAuth } from "../middleware/auth.js";
import { getTodayStr, formatDateDisplay } from "../utils/dateHelpers.js";

const router = Router();
router.use(ensureAdminAuth);

// ════════════════════════════════════ Helpers ═══════════════════════════════════
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

/** Build the redirect URL back to the shifts hub, preserving shift. */
function hubUrl(shiftId: number | string): string {
  return `/admin/shifts?shift=${shiftId}`;
}

/**
 * Renormalize a list of task rows to display_order 0, 1, 2, … in a single
 * UPDATE … FROM (VALUES …) statement.
 */
async function bulkRenormalizeOrder(
  client: PoolClient,
  table: "shift_tasks" | "extra_day_tasks",
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
  const today = getTodayStr();
  const [empRes, shiftRes, taskRes, extraRes, activityRes] = await Promise.all([
    pool.query("SELECT COUNT(*) as count FROM employees"),
    pool.query("SELECT COUNT(*) as count FROM shifts"),
    pool.query("SELECT COUNT(*) as count FROM tasks"),
    pool.query("SELECT COUNT(*) as count FROM extra_day_tasks WHERE date >= $1", [today]),
    pool.query(`
      WITH parsed AS (
        SELECT
          employee_name,
          (SELECT COUNT(*) FROM unnest(string_to_array(task_summary, ' | ')) AS item WHERE item LIKE '✓%') AS completed,
          array_length(string_to_array(task_summary, ' | '), 1) AS total
        FROM submissions
        WHERE submitted_at >= NOW() - INTERVAL '30 days'
          AND task_summary <> ''
      )
      SELECT
        employee_name,
        COUNT(*)::int AS submission_count,
        ROUND(AVG(CASE WHEN total > 0 THEN completed::float / total * 100 ELSE NULL END))::int AS avg_completion_pct
      FROM parsed
      GROUP BY employee_name
      ORDER BY employee_name
    `),
  ]);

  res.render("admin/dashboard", {
    employeeCount: empRes.rows[0].count,
    shiftCount: shiftRes.rows[0].count,
    taskCount: taskRes.rows[0].count,
    customCount: extraRes.rows[0].count,
    staffActivity: activityRes.rows as { employee_name: string; submission_count: number; avg_completion_pct: number | null }[],
    today,
  });
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
router.get("/shifts", async (req, res) => {
  const today = getTodayStr();
  const shifts = (await pool.query(
    `SELECT * FROM shifts ORDER BY CASE LOWER(name) WHEN 'open' THEN 0 WHEN 'mid' THEN 1 WHEN 'close' THEN 2 ELSE 3 END, name`
  )).rows;

  const requestedShift = Number(req.query.shift);
  const selectedShift =
    shifts.find((s: { id: number }) => s.id === requestedShift) || shifts[0] || null;

  const allTasks = (await pool.query("SELECT * FROM tasks ORDER BY name")).rows;

  let standingTasks: { id: number; task_name: string; display_order: number }[] = [];
  let todayExtraTasks: { id: number; task_name: string; display_order: number }[] = [];

  if (selectedShift) {
    const [stRes, etRes] = await Promise.all([
      pool.query(
        `SELECT st.id, st.display_order, t.name as task_name
         FROM shift_tasks st
         JOIN tasks t ON t.id = st.task_id
         WHERE st.shift_id = $1
         ORDER BY st.display_order`,
        [selectedShift.id]
      ),
      pool.query(
        `SELECT id, task_name, display_order
         FROM extra_day_tasks
         WHERE shift_id = $1 AND date = $2
         ORDER BY display_order`,
        [selectedShift.id, today]
      ),
    ]);
    standingTasks = stRes.rows;
    todayExtraTasks = etRes.rows;
  }

  res.render("admin/shifts", {
    shifts,
    selectedShift,
    allTasks,
    standingTasks,
    todayExtraTasks,
    today,
    formatDateDisplay,
  });
});

// ── Add a Task (unified: daily → standing list, one-off → extra day tasks) ────
router.post("/shifts/add-task", async (req, res) => {
  const body = req.body as {
    name?: string;
    type?: string;
    shiftIds?: string | string[];
    date?: string;
  };

  const name = body.name?.trim();
  if (!name) return void res.redirect("/admin/shifts");

  const type = body.type === "daily" ? "daily" : "oneoff";
  const rawIds = Array.isArray(body.shiftIds)
    ? body.shiftIds
    : body.shiftIds
    ? [body.shiftIds]
    : [];
  const shiftIds = rawIds.map(Number).filter((n) => n > 0);
  const date = body.date?.trim() || getTodayStr();

  if (shiftIds.length === 0) return void res.redirect("/admin/shifts");

  if (type === "daily") {
    await withTransaction(async (client) => {
      const taskId = await upsertTaskByName(client, name);
      for (const shiftId of shiftIds) {
        const maxRow = (
          await client.query(
            "SELECT COALESCE(MAX(display_order), -1) as max FROM shift_tasks WHERE shift_id = $1",
            [shiftId]
          )
        ).rows[0];
        await client.query(
          `INSERT INTO shift_tasks (shift_id, task_id, display_order) VALUES ($1, $2, $3)
           ON CONFLICT (shift_id, task_id) DO NOTHING`,
          [shiftId, taskId, (maxRow.max as number) + 1]
        );
      }
    });
  } else {
    for (const shiftId of shiftIds) {
      const maxRow = (
        await pool.query(
          "SELECT COALESCE(MAX(display_order), -1) as max FROM extra_day_tasks WHERE shift_id = $1 AND date = $2",
          [shiftId, date]
        )
      ).rows[0];
      await pool.query(
        "INSERT INTO extra_day_tasks (shift_id, date, task_name, display_order) VALUES ($1, $2, $3, $4)",
        [shiftId, date, name, (maxRow.max as number) + 1]
      );
    }
  }

  res.redirect(shiftIds.length === 1 ? hubUrl(shiftIds[0]) : "/admin/shifts");
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
  const wantsJson = req.headers.accept?.includes("application/json") ?? false;

  let shiftTaskId: number | null = null;
  let created = false;

  if (name) {
    await withTransaction(async (client) => {
      await client.query("SELECT id FROM shifts WHERE id = $1 FOR UPDATE", [shiftId]);

      const taskId = await upsertTaskByName(client, name);
      const maxRow = (await client.query(
        "SELECT COALESCE(MAX(display_order), -1) as max FROM shift_tasks WHERE shift_id = $1",
        [shiftId]
      )).rows[0];
      const inserted = await client.query(
        `INSERT INTO shift_tasks (shift_id, task_id, display_order) VALUES ($1, $2, $3)
         ON CONFLICT (shift_id, task_id) DO NOTHING
         RETURNING id`,
        [shiftId, taskId, (maxRow.max as number) + 1]
      );
      if (inserted.rows[0]) {
        shiftTaskId = inserted.rows[0].id;
        created = true;
      } else {
        const existing = await client.query(
          "SELECT id FROM shift_tasks WHERE shift_id = $1 AND task_id = $2",
          [shiftId, taskId]
        );
        shiftTaskId = existing.rows[0]?.id ?? null;
        created = false;
      }
    });
  }

  if (wantsJson) {
    if (shiftTaskId !== null && name) {
      res.json({ id: shiftTaskId, name, created });
    } else {
      res.status(400).json({ error: "Invalid task name" });
    }
    return;
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

// ── Extra tasks for a specific day ──────────────────────────────────────────
router.post("/shifts/:shiftId/day/:date/remove-extra/:id", async (req, res) => {
  await pool.query("DELETE FROM extra_day_tasks WHERE id = $1", [Number(req.params.id)]);
  res.redirect(hubUrl(req.params.shiftId));
});

router.post("/shifts/:shiftId/day/:date/reorder-extra", async (req, res) => {
  const shiftId = Number(req.params.shiftId);
  const { date } = req.params;
  const ids = (req.body.ids as unknown[]);
  if (!Array.isArray(ids) || ids.length === 0) return void res.json({ ok: false });
  const idArray = ids.map(Number).filter(n => n > 0);
  await withTransaction(async (client) => {
    await client.query(
      "SELECT id FROM extra_day_tasks WHERE shift_id = $1 AND date = $2 LIMIT 1 FOR UPDATE",
      [shiftId, date]
    );
    await bulkRenormalizeOrder(client, "extra_day_tasks", idArray);
  });
  res.json({ ok: true });
});

// ════════════════════════════════════ Live Status ════════════════════════════
router.get("/live", async (_req, res) => {
  const today = getTodayStr();
  const shifts = (await pool.query(
    `SELECT * FROM shifts ORDER BY CASE LOWER(name) WHEN 'open' THEN 0 WHEN 'mid' THEN 1 WHEN 'close' THEN 2 ELSE 3 END, name`
  )).rows as { id: number; name: string }[];

  const shiftData = await Promise.all(
    shifts.map(async (shift) => {
      const [standingRes, extraRes, compRes] = await Promise.all([
        pool.query(
          `SELECT t.name as task_name FROM shift_tasks st
           JOIN tasks t ON t.id = st.task_id
           WHERE st.shift_id = $1 ORDER BY st.display_order`,
          [shift.id]
        ),
        pool.query(
          `SELECT task_name FROM extra_day_tasks
           WHERE shift_id = $1 AND date = $2 ORDER BY display_order`,
          [shift.id, today]
        ),
        pool.query(
          `SELECT task_name, completed_by_name, completed_at
           FROM task_completions WHERE date = $1 AND shift_id = $2`,
          [today, shift.id]
        ),
      ]);

      const compMap = new Map<string, { by: string; at: string }>();
      for (const row of compRes.rows as {
        task_name: string;
        completed_by_name: string;
        completed_at: Date | string;
      }[]) {
        compMap.set(row.task_name, {
          by: row.completed_by_name,
          at:
            row.completed_at instanceof Date
              ? row.completed_at.toISOString()
              : String(row.completed_at),
        });
      }

      const tasks = [
        ...(standingRes.rows as { task_name: string }[]).map((r) => ({
          name: r.task_name,
          isExtra: false,
        })),
        ...(extraRes.rows as { task_name: string }[]).map((r) => ({
          name: r.task_name,
          isExtra: true,
        })),
      ].map((t) => {
        const c = compMap.get(t.name);
        return {
          name: t.name,
          isExtra: t.isExtra,
          completed: !!c,
          completedBy: c?.by ?? null,
          completedAtIso: c?.at ?? null,
        };
      });

      const done = tasks.filter((t) => t.completed).length;
      return { shift, tasks, done, total: tasks.length };
    })
  );

  res.render("admin/live", { shiftData, today, formatDateDisplay });
});

// ════════════════════════════════════ Reports ═════════════════════════════════
router.get("/reports", async (req, res) => {
  try {
    await pool.query("DELETE FROM submissions WHERE submitted_at < NOW() - INTERVAL '30 days'");
    const employeeFilter = typeof req.query.employee === "string" && req.query.employee.trim()
      ? req.query.employee.trim()
      : null;
    const rows = (await pool.query(
      employeeFilter
        ? "SELECT * FROM submissions WHERE submitted_at >= NOW() - INTERVAL '30 days' AND employee_name = $1 ORDER BY submitted_at DESC"
        : "SELECT * FROM submissions WHERE submitted_at >= NOW() - INTERVAL '30 days' ORDER BY submitted_at DESC",
      employeeFilter ? [employeeFilter] : []
    )).rows;

    const shiftOrder = (n: string) => {
      const l = n.toLowerCase();
      return l === "open" ? 0 : l === "mid" ? 1 : l === "close" ? 2 : 3;
    };

    const dateMap = new Map<string, Map<string, typeof rows>>();
    for (const row of rows) {
      const date = (row.date as string) || "unknown";
      if (!dateMap.has(date)) dateMap.set(date, new Map());
      const sm = dateMap.get(date)!;
      const shift = (row.shift_name as string) || "—";
      if (!sm.has(shift)) sm.set(shift, []);
      sm.get(shift)!.push(row);
    }

    const groups = [...dateMap.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, sm]) => {
        const d = new Date(date + "T12:00:00");
        const label = d.toLocaleDateString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
        });
        const shifts = [...sm.entries()]
          .sort(([a], [b]) => shiftOrder(a) - shiftOrder(b) || a.localeCompare(b))
          .map(([shiftName, items]) => ({ shiftName, items }));
        return { date, label, shifts };
      });

    res.render("admin/reports", { groups, dbError: false, employeeFilter });
  } catch (err) {
    const { logger } = await import("../lib/logger.js");
    logger.error({ err }, "Failed to load submissions from DB");
    res.render("admin/reports", { groups: [], dbError: true, employeeFilter: null });
  }
});

export default router;
