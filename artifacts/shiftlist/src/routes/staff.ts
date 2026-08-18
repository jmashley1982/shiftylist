import { Router } from "express";
import { pool } from "../db/index.js";
import { ensureStaffAuth } from "../middleware/auth.js";
import { getBusinessDayStr } from "../utils/dateHelpers.js";
import { logger } from "../lib/logger.js";
import { staffUrl } from "../lib/urls.js";
import { sweepStaleSessionsOnRequest } from "../utils/autoSubmit.js";
import { loadBoard, recordBoardView, STATUS_LABELS } from "../lib/companyBoard.js";
import { formatDateMaybeYear, formatLocalDate } from "../utils/dateHelpers.js";
import { restoreActiveShift } from "../lib/activeShift.js";

const router = Router();

/** What the checklist page needs to draw a tick: who, when, and whether it was late. */
interface Completion {
  byName: string;
  at: string;
  lateReason: string | null;
}

/**
 * Everything ticked off for one shift on one business day, keyed by task name.
 *
 * The single source of truth for the checkboxes. The page renders from it on
 * load and re-reads it from GET /completions while it is open, so a stale or
 * restored-from-cache page repairs itself instead of showing a shift's work
 * as undone.
 */
async function loadCompletions(
  date: string,
  shiftId: number
): Promise<Record<string, Completion>> {
  const res = await pool.query(
    `SELECT task_name, completed_by_name, completed_at, late_reason
     FROM task_completions
     WHERE date = $1 AND shift_id = $2`,
    [date, shiftId]
  );

  const map: Record<string, Completion> = {};
  for (const row of res.rows as {
    task_name: string;
    completed_by_name: string;
    completed_at: Date | string;
    late_reason: string | null;
  }[]) {
    map[row.task_name] = {
      byName: row.completed_by_name,
      at:
        row.completed_at instanceof Date
          ? row.completed_at.toISOString()
          : String(row.completed_at),
      lateReason: row.late_reason,
    };
  }
  return map;
}

/**
 * The Company Board, read-only. Deliberately guarded by ensureStaffAuth alone
 * — that only requires an employeeId, so this is reachable straight after
 * login, before a shift has been picked. That's where staff first land (see
 * POST /confirm-name in routes/auth.ts).
 */
router.get("/company", ensureStaffAuth, async (req, res) => {
  const board = await loadBoard();

  // Awaited, not fire-and-forget: on Workers the request's connection pool is
  // closed the moment the response ends, which would kill a floating write.
  try {
    await recordBoardView(req.session.employeeId!);
  } catch (err) {
    // Worst case they are shown the board again at their next login.
    logger.error({ err }, "Failed to record a company board view");
  }

  res.render("companyBoard", {
    board,
    employeeName: req.session.employeeName,
    statusLabels: STATUS_LABELS,
    // Set when arriving from login, so the page offers "Continue to my shift"
    // instead of a link back to a task list they haven't opened yet.
    nextIsShift: req.query["next"] === "shift",
    hasShift: Boolean(req.session.selectedShiftId),
    formatDateMaybeYear,
    formatLocalDate,
  });
});

router.get("/tasks", ensureStaffAuth, async (req, res) => {
  sweepStaleSessionsOnRequest();
  const today = getBusinessDayStr();
  // Not just the session: someone whose login expired mid-shift is put back
  // on the shift they were already working, so their ticks come back with them.
  const shiftId = req.session.selectedShiftId ?? (await restoreActiveShift(req));

  if (!shiftId) {
    return void res.redirect(staffUrl("/select-shift"));
  }

  const [standingRes, extraRes, completionMap, shiftRes] = await Promise.all([
    pool.query(`
      SELECT t.name as task_name, st.time_start, st.time_end
      FROM shift_tasks st
      JOIN tasks t ON t.id = st.task_id
      WHERE st.shift_id = $1
      ORDER BY st.display_order
    `, [shiftId]),
    pool.query(`
      SELECT task_name, time_start, time_end
      FROM extra_day_tasks
      WHERE shift_id = $1 AND date = $2
      ORDER BY display_order
    `, [shiftId, today]),
    loadCompletions(today, shiftId),
    pool.query("SELECT name FROM shifts WHERE id = $1", [shiftId]),
  ]);

  const standingTasks = (standingRes.rows as { task_name: string; time_start: string | null; time_end: string | null }[]).map((t) => ({
    text: t.task_name,
    isExtra: false,
    timeStart: t.time_start ?? null,
    timeEnd: t.time_end ?? null,
  }));
  const extraTasks = (extraRes.rows as { task_name: string; time_start: string | null; time_end: string | null }[]).map((t) => ({
    text: t.task_name,
    isExtra: true,
    timeStart: t.time_start ?? null,
    timeEnd: t.time_end ?? null,
  }));
  // Extra (one-off) tasks go first so they stand out at the top
  const tasks = [...extraTasks, ...standingTasks];

  if (tasks.length === 0) {
    return void res.render("noTasks", { employeeName: req.session.employeeName });
  }

  const shiftName =
    (shiftRes.rows[0] as { name: string } | undefined)?.name ?? "";

  // Fetch active staff notice (show if any field is non-empty)
  let staffNotice: { title: string; subtitle: string; body: string } | null = null;
  try {
    const noticeRes = await pool.query<{ title: string; subtitle: string; body: string }>(
      `SELECT title, subtitle, body FROM staff_notice ORDER BY id DESC LIMIT 1`
    );
    const n = noticeRes.rows[0];
    if (n && (n.title || n.subtitle || n.body)) staffNotice = n;
  } catch {
    // ignore — notice is non-critical
  }

  res.render("todolist", {
    tasks,
    extraCount: extraTasks.length,
    employeeName: req.session.employeeName,
    shift: shiftName,
    completionMap,
    staffNotice,
  });
});

/**
 * The checklist's ticks, as JSON. The page polls this while it is open.
 *
 * Why it exists: the checkbox state used to be baked into the HTML once, at
 * render time. A page restored from the browser's back/forward cache, or
 * reloaded after a login bounce, therefore showed whatever was true when it
 * was first drawn — an empty checklist, hours of work apparently undone —
 * even though every tick was safe in the database. Now the page re-reads the
 * truth from here and repairs itself.
 *
 * Also how two people working the same shift see each other's ticks without
 * either of them reloading.
 */
router.get("/completions", ensureStaffAuth, async (req, res) => {
  const shiftId = req.session.selectedShiftId ?? (await restoreActiveShift(req));
  if (!shiftId) {
    return void res.json({ ok: false, error: "No shift selected" });
  }

  try {
    const completions = await loadCompletions(getBusinessDayStr(), shiftId);
    res.json({ ok: true, completions });
  } catch (err) {
    logger.error({ err }, "Failed to read task completions");
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

router.post("/complete", ensureStaffAuth, async (req, res) => {
  const { taskName, lateReason } = req.body as { taskName?: string; lateReason?: string };
  const shiftId = req.session.selectedShiftId ?? (await restoreActiveShift(req));
  const date = getBusinessDayStr();

  if (!shiftId || !taskName?.trim()) {
    return void res.status(400).json({ ok: false, error: "Missing taskName or shift" });
  }

  try {
    await pool.query(
      `INSERT INTO task_completions
         (date, shift_id, task_name, completed_by_name, completed_by_code, late_reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (date, shift_id, task_name) DO UPDATE
         SET completed_by_name = EXCLUDED.completed_by_name,
             completed_by_code = EXCLUDED.completed_by_code,
             completed_at      = task_completions.completed_at,
             late_reason       = EXCLUDED.late_reason`,
      [
        date,
        shiftId,
        taskName.trim(),
        req.session.employeeName ?? "",
        req.session.employeeCode ?? "",
        lateReason?.trim() ?? null,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to save task completion");
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

router.post("/uncomplete", ensureStaffAuth, async (req, res) => {
  const { taskName } = req.body as { taskName?: string };
  const shiftId = req.session.selectedShiftId ?? (await restoreActiveShift(req));
  const date = getBusinessDayStr();

  if (!shiftId || !taskName?.trim()) {
    return void res.status(400).json({ ok: false, error: "Missing taskName or shift" });
  }

  try {
    await pool.query(
      `DELETE FROM task_completions
       WHERE date = $1 AND shift_id = $2 AND task_name = $3`,
      [date, shiftId, taskName.trim()]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to remove task completion");
    res.status(500).json({ ok: false, error: "DB error" });
  }
});

router.post("/submit", ensureStaffAuth, async (req, res) => {
  interface TaskEntry {
    text: string;
    completed: boolean;
    completionTime: string | null;
    lateReason?: string | null;
  }
  let tasks: TaskEntry[] = [];
  let notes = "";
  try {
    const raw = req.body as { tasks?: string; notes?: string };
    tasks = JSON.parse(raw.tasks ?? "[]") as TaskEntry[];
    notes = raw.notes ?? "";
  } catch {
    return void res.status(400).send("Invalid task data");
  }

  const shiftId = req.session.selectedShiftId ?? (await restoreActiveShift(req));
  const shiftName = shiftId
    ? (
        (await pool.query("SELECT name FROM shifts WHERE id = $1", [shiftId]))
          .rows[0] as { name: string } | undefined
      )?.name ?? ""
    : "";

  const date = getBusinessDayStr();
  const taskSummary = tasks
    .map((t) => {
      let s = `${t.completed ? "✓" : "✗"} ${t.text}`;
      if (t.completionTime) s += ` (${t.completionTime})`;
      if (t.lateReason) s += ` — Late: ${t.lateReason}`;
      return s;
    })
    .join(" | ");

  try {
    await pool.query(
      `INSERT INTO submissions (employee_code, employee_name, shift_name, date, task_summary, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req.session.employeeCode ?? "",
        req.session.employeeName ?? "",
        shiftName,
        date,
        taskSummary,
        notes,
      ]
    );
  } catch (err) {
    logger.error(
      { err },
      "Failed to save submission to DB — continuing with confirmation"
    );
  }

  req.session.selectedShiftId = undefined;

  // Clear active session record so admin live view shows them as finished
  try {
    await pool.query(
      "DELETE FROM active_sessions WHERE employee_id = $1 AND date = $2",
      [req.session.employeeId, date]
    );
  } catch {
    // non-fatal
  }

  res.render("submitted", {
    employeeName: req.session.employeeName,
    shift: shiftName,
    date,
    tasks,
    notes,
  });
});

export default router;
