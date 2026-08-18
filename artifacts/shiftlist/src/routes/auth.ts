import { Router } from "express";
import { pool } from "../db/index.js";
import { staffUrl } from "../lib/urls.js";
import { logger } from "../lib/logger.js";
import { boardHasGoals, hasSeenBoardToday } from "../lib/companyBoard.js";
import { restoreActiveShift } from "../lib/activeShift.js";
import { getBusinessDayStr } from "../utils/dateHelpers.js";

const router = Router();

// Mounted at /staff — this is the staff login flow. Admin auth is no longer
// handled here: /admin/shifts trusts the Viking ordering app's session
// cookie instead. See src/middleware/vikingAuth.ts.

router.get("/", (req, res) => {
  if (req.session.employeeId) return void res.redirect(staffUrl("/tasks"));
  res.render("login", { error: null });
});

router.post("/", async (req, res) => {
  const { code } = req.body as { code: string };
  const result = await pool.query(
    "SELECT * FROM employees WHERE code = $1",
    [code]
  );
  const employee = result.rows[0];
  if (!employee) {
    return void res.render("login", { error: "Invalid code. Please try again." });
  }
  req.session.pendingEmployee = employee;
  res.redirect(staffUrl("/confirm-name"));
});

router.get("/confirm-name", (req, res) => {
  if (!req.session.pendingEmployee) return void res.redirect(staffUrl());
  res.render("confirmName", { employee: req.session.pendingEmployee });
});

router.post("/confirm-name", async (req, res) => {
  const { confirm } = req.body as { confirm: string };
  if (confirm !== "yes") {
    delete req.session.pendingEmployee;
    return void res.redirect(staffUrl());
  }

  const emp = req.session.pendingEmployee!;
  req.session.employeeId = emp.id;
  req.session.employeeName = emp.name;
  req.session.employeeCode = emp.code;
  delete req.session.pendingEmployee;

  // Already part-way through a shift? Go straight back to that checklist
  // instead of asking which shift this is and risking the wrong answer —
  // pick the wrong one and the ticks already saved are invisible.
  const resumedShiftId = await restoreActiveShift(req);

  // Staff see the company-wide to-do list once a day, before getting on with
  // their own tasks — skipped when the board is empty (a dead click between
  // login and shift select) or when they've already seen it today (someone
  // working a double shouldn't be shown it twice).
  let showBoard = false;
  try {
    showBoard = (await boardHasGoals()) && !(await hasSeenBoardToday(emp.id));
  } catch (err) {
    // Never let the board block someone from starting their shift.
    logger.error({ err }, "Failed to check the company board — skipping it");
  }

  const next = resumedShiftId ? staffUrl("/tasks") : staffUrl("/select-shift");
  res.redirect(showBoard ? staffUrl("/company?next=shift") : next);
});

router.get("/select-shift", async (req, res) => {
  if (!req.session.employeeId) return void res.redirect(staffUrl());
  const shifts = (await pool.query(
    `SELECT * FROM shifts ORDER BY CASE LOWER(name) WHEN 'open' THEN 0 WHEN 'mid' THEN 1 WHEN 'close' THEN 2 ELSE 3 END, name`
  )).rows;
  // Anyone with a shift still open today gets it pre-ticked and labelled, so
  // the picker cannot quietly move them onto an empty checklist. Not forced:
  // a double shift is a real thing, and they can still choose another.
  const currentShiftId =
    req.session.selectedShiftId ?? (await restoreActiveShift(req)) ?? null;
  res.render("selectShift", {
    employeeName: req.session.employeeName,
    shifts,
    currentShiftId,
  });
});

router.post("/select-shift", async (req, res) => {
  if (!req.session.employeeId) return void res.redirect(staffUrl());
  const { shiftId } = req.body as { shiftId: string };
  if (!shiftId) return void res.redirect(staffUrl("/select-shift"));
  const shiftIdNum = Number(shiftId);
  req.session.selectedShiftId = shiftIdNum;

  const today = getBusinessDayStr();
  const shiftRow = await pool.query("SELECT name FROM shifts WHERE id = $1", [shiftIdNum]);
  const shiftName = (shiftRow.rows[0] as { name: string } | undefined)?.name ?? "";
  await pool.query(
    `INSERT INTO active_sessions (employee_id, employee_name, shift_id, shift_name, date)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (employee_id, date) DO UPDATE
       SET shift_id = EXCLUDED.shift_id,
           shift_name = EXCLUDED.shift_name,
           started_at = NOW()`,
    [req.session.employeeId, req.session.employeeName ?? "", shiftIdNum, shiftName, today]
  );

  res.redirect(staffUrl("/tasks"));
});

router.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect(staffUrl()));
});

export default router;
