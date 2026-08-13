import { Router } from "express";
import { pool } from "../db/index.js";
import { adminUrl } from "../lib/urls.js";
import { logger } from "../lib/logger.js";
import { withTransaction, bulkRenormalizeOrder } from "../lib/dbHelpers.js";
import {
  ensureCompanyTables,
  loadBoard,
  isGoalStatus,
  STATUS_LABELS,
  UNCATEGORIZED_NAME,
} from "../lib/companyBoard.js";
import { formatDateMaybeYear, formatLocalDate } from "../utils/dateHelpers.js";

/**
 * The manager side of the Company Board, mounted at /admin/shifts/company.
 *
 * Kept out of src/routes/admin.ts, which is already 1100+ lines. Because this
 * is a sibling router rather than a sub-router of that file, it does NOT
 * inherit its `router.use(ensureAdminAuth)` — the guard is applied where this
 * is mounted, in src/routes/index.ts.
 */

const router = Router();

router.use((_req, _res, next) => {
  ensureCompanyTables().then(() => next(), next);
});

/** Trim, and collapse an empty string to null. */
function optional(value: unknown): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed === "" ? null : trimmed;
}

/** A YYYY-MM-DD date, or null for anything else — including a cleared field. */
function optionalDate(value: unknown): string | null {
  const date = optional(value);
  return date !== null && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

/** A positive integer id, or null. Guards every :id route param. */
function idParam(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ══════════════════════════════════ The board ═══════════════════════════════════

router.get("/", async (_req, res) => {
  const [board, catRes] = await Promise.all([
    // The editor shows the manager's own arrangement, not the status-led
    // order staff get — that's what the ▲/▼ buttons move things within.
    loadBoard({ sortBy: "order" }),
    pool.query<{ id: number; name: string; display_order: number; goal_count: number }>(`
      SELECT c.id, c.name, c.display_order,
             COUNT(g.id)::int AS goal_count
      FROM company_categories c
      LEFT JOIN company_goals g ON g.category_id = c.id
      GROUP BY c.id, c.name, c.display_order
      ORDER BY c.display_order, c.name
    `),
  ]);

  res.render("admin/company", {
    board,
    categories: catRes.rows,
    statusLabels: STATUS_LABELS,
    uncategorizedName: UNCATEGORIZED_NAME,
    formatDateMaybeYear,
    formatLocalDate,
  });
});

// ═════════════════════════════════════ Goals ════════════════════════════════════

router.post("/add", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const title = optional(body["title"]);
  if (!title) return void res.redirect(adminUrl("/company"));

  // "+ New category" wins over the dropdown when both are filled in — the
  // manager clearly meant the one they just typed.
  const newCategory = optional(body["newCategory"]);
  let categoryId = idParam(body["categoryId"]);

  await withTransaction(async (client) => {
    if (newCategory) {
      const created = await client.query<{ id: number }>(
        `INSERT INTO company_categories (name, display_order)
         VALUES ($1, (SELECT COALESCE(MAX(display_order) + 1, 0) FROM company_categories))
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [newCategory]
      );
      categoryId = created.rows[0].id;
    }

    await client.query(
      `INSERT INTO company_goals (category_id, title, detail, owner, target_date, display_order)
       VALUES ($1, $2, $3, $4, $5,
               (SELECT COALESCE(MAX(display_order) + 1, 0) FROM company_goals))`,
      [
        categoryId,
        title,
        optional(body["detail"]) ?? "",
        optional(body["owner"]) ?? "",
        optionalDate(body["targetDate"]),
      ]
    );
  });

  res.redirect(adminUrl("/company"));
});

router.post("/:id/edit", async (req, res) => {
  const id = idParam(req.params["id"]);
  if (id === null) return void res.status(400).json({ ok: false, error: "Bad id" });

  const body = req.body as Record<string, unknown>;
  const title = optional(body["title"]);
  if (!title) return void res.status(400).json({ ok: false, error: "Title is required" });

  try {
    await pool.query(
      `UPDATE company_goals
       SET title = $2, detail = $3, owner = $4, target_date = $5, category_id = $6, updated_at = NOW()
       WHERE id = $1`,
      [
        id,
        title,
        optional(body["detail"]) ?? "",
        optional(body["owner"]) ?? "",
        optionalDate(body["targetDate"]),
        idParam(body["categoryId"]),
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "Failed to update company goal");
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

router.post("/:id/status", async (req, res) => {
  const id = idParam(req.params["id"]);
  const { status } = req.body as { status?: string };
  if (id === null || !isGoalStatus(status)) {
    return void res.status(400).json({ ok: false, error: "Bad id or status" });
  }

  try {
    // completed_at is set on the way into "done" and cleared on the way out,
    // so the staff board's Completed section always has a real date. Moving
    // an already-done goal to done again keeps the original timestamp.
    const result = await pool.query<{ completed_at: Date | null }>(
      `UPDATE company_goals
       SET status = $2,
           completed_at = CASE
             WHEN $2 <> 'done' THEN NULL
             WHEN completed_at IS NULL THEN NOW()
             ELSE completed_at
           END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING completed_at`,
      [id, status]
    );
    if (result.rowCount === 0) {
      return void res.status(404).json({ ok: false, error: "No such goal" });
    }
    res.json({ ok: true, status, completedAt: result.rows[0].completed_at });
  } catch (err) {
    logger.error({ err, id }, "Failed to set company goal status");
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

router.post("/:id/delete", async (req, res) => {
  const id = idParam(req.params["id"]);
  if (id !== null) {
    // company_goal_updates cascades.
    await pool.query("DELETE FROM company_goals WHERE id = $1", [id]);
  }
  res.redirect(adminUrl("/company"));
});

/**
 * Move one goal up or down among its siblings: the page sends that category's
 * ids in their new order and they are renormalized to 0, 1, 2, …
 *
 * Orders are only ever compared within a category, so two categories reusing
 * the same numbers is harmless — see loadBoard().
 */
router.post("/reorder", async (req, res) => {
  const { ids } = req.body as { ids?: unknown };
  const orderedIds = Array.isArray(ids)
    ? ids.map((v) => idParam(v)).filter((v): v is number => v !== null)
    : [];

  if (orderedIds.length === 0) {
    return void res.status(400).json({ ok: false, error: "No ids" });
  }

  try {
    await withTransaction((client) => bulkRenormalizeOrder(client, "company_goals", orderedIds));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to reorder company goals");
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

// ════════════════════════════════ Progress notes ════════════════════════════════

router.post("/:id/notes", async (req, res) => {
  const id = idParam(req.params["id"]);
  const body = req.body as Record<string, unknown>;
  const note = optional(body["note"]);
  if (id === null || !note) return void res.redirect(adminUrl("/company"));

  await pool.query(
    `INSERT INTO company_goal_updates (goal_id, note, author) VALUES ($1, $2, $3)`,
    [id, note, optional(body["author"]) ?? "Management"]
  );
  // Posting an update is a change to the goal, even though no column moved.
  await pool.query("UPDATE company_goals SET updated_at = NOW() WHERE id = $1", [id]);

  res.redirect(`${adminUrl("/company")}#goal-${id}`);
});

router.post("/notes/:noteId/delete", async (req, res) => {
  const noteId = idParam(req.params["noteId"]);
  if (noteId !== null) {
    await pool.query("DELETE FROM company_goal_updates WHERE id = $1", [noteId]);
  }
  res.redirect(adminUrl("/company"));
});

// ═══════════════════════════════════ Categories ═════════════════════════════════

router.post("/categories/add", async (req, res) => {
  const name = optional((req.body as Record<string, unknown>)["name"]);
  if (name) {
    await pool.query(
      `INSERT INTO company_categories (name, display_order)
       VALUES ($1, (SELECT COALESCE(MAX(display_order) + 1, 0) FROM company_categories))
       ON CONFLICT (name) DO NOTHING`,
      [name]
    );
  }
  res.redirect(adminUrl("/company"));
});

router.post("/categories/:id/rename", async (req, res) => {
  const id = idParam(req.params["id"]);
  const name = optional((req.body as Record<string, unknown>)["name"]);
  if (id === null || !name) {
    return void res.status(400).json({ ok: false, error: "Bad id or name" });
  }

  try {
    await pool.query("UPDATE company_categories SET name = $2 WHERE id = $1", [id, name]);
    res.json({ ok: true });
  } catch (err) {
    // The unique constraint on name is the likely cause — say so rather than
    // reporting a generic failure the manager can't act on.
    logger.error({ err, id }, "Failed to rename company category");
    res.status(400).json({ ok: false, error: "That category name is already in use" });
  }
});

router.post("/categories/:id/delete", async (req, res) => {
  const id = idParam(req.params["id"]);
  if (id !== null) {
    // ON DELETE SET NULL — the goals survive and drop into "General" rather
    // than disappearing along with their heading.
    await pool.query("DELETE FROM company_categories WHERE id = $1", [id]);
  }
  res.redirect(adminUrl("/company"));
});

router.post("/categories/reorder", async (req, res) => {
  const { ids } = req.body as { ids?: unknown };
  const orderedIds = Array.isArray(ids)
    ? ids.map((v) => idParam(v)).filter((v): v is number => v !== null)
    : [];

  if (orderedIds.length === 0) {
    return void res.status(400).json({ ok: false, error: "No ids" });
  }

  try {
    await withTransaction(async (client) => {
      const valuePlaceholders = orderedIds
        .map((_, i) => `($${i * 2 + 1}::int, $${i * 2 + 2}::int)`)
        .join(", ");
      await client.query(
        `UPDATE company_categories AS c
         SET display_order = vals.new_order
         FROM (VALUES ${valuePlaceholders}) AS vals(row_id, new_order)
         WHERE c.id = vals.row_id`,
        orderedIds.flatMap((id, i) => [id, i])
      );
    });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to reorder company categories");
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

export default router;
