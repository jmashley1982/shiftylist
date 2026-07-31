import { Router } from "express";
import { pool } from "../db/index.js";
import { staffUrl } from "../lib/urls.js";

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

router.post("/confirm-name", (req, res) => {
  const { confirm } = req.body as { confirm: string };
  if (confirm === "yes") {
    const emp = req.session.pendingEmployee!;
    req.session.employeeId = emp.id;
    req.session.employeeName = emp.name;
    req.session.employeeCode = emp.code;
    delete req.session.pendingEmployee;
    return void res.redirect(staffUrl("/select-shift"));
  }
  delete req.session.pendingEmployee;
  res.redirect(staffUrl());
});

router.get("/select-shift", async (req, res) => {
  if (!req.session.employeeId) return void res.redirect(staffUrl());
  const shifts = (await pool.query(
    `SELECT * FROM shifts ORDER BY CASE LOWER(name) WHEN 'open' THEN 0 WHEN 'mid' THEN 1 WHEN 'close' THEN 2 ELSE 3 END, name`
  )).rows;
  res.render("selectShift", { employeeName: req.session.employeeName, shifts });
});

router.post("/select-shift", async (req, res) => {
  if (!req.session.employeeId) return void res.redirect(staffUrl());
  const { shiftId } = req.body as { shiftId: string };
  if (!shiftId) return void res.redirect(staffUrl("/select-shift"));
  const shiftIdNum = Number(shiftId);
  req.session.selectedShiftId = shiftIdNum;

  const today = (await import("../utils/dateHelpers.js")).getBusinessDayStr();
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
