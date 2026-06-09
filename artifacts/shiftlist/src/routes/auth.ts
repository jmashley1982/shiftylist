import { Router } from "express";
import db, { type Employee } from "../db/index.js";

const router = Router();

router.get("/", (_req, res) => {
  res.redirect("/login");
});

router.get("/login", (req, res) => {
  if (req.session.employeeId) return void res.redirect("/staff/tasks");
  res.render("login", { error: null });
});

router.post("/login", (req, res) => {
  const { code } = req.body as { code: string };
  const employee = db
    .prepare("SELECT * FROM employees WHERE code = ?")
    .get(code) as Employee | undefined;
  if (!employee) {
    return void res.render("login", { error: "Invalid code. Please try again." });
  }
  req.session.pendingEmployee = employee;
  res.redirect("/confirm-name");
});

router.get("/confirm-name", (req, res) => {
  if (!req.session.pendingEmployee) return void res.redirect("/login");
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
    return void res.redirect("/staff/tasks");
  }
  delete req.session.pendingEmployee;
  res.redirect("/login");
});

router.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

router.get("/admin/login", (req, res) => {
  if (req.session.isAdmin) return void res.redirect("/admin/dashboard");
  res.render("admin/login", { error: null });
});

router.post("/admin/login", (req, res) => {
  const { adminCode } = req.body as { adminCode: string };
  const expected = process.env["ADMIN_CODE"] ?? "1234";
  if (adminCode === expected) {
    req.session.isAdmin = true;
    return void res.redirect("/admin/dashboard");
  }
  res.render("admin/login", { error: "Invalid admin code." });
});

router.get("/admin/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

export default router;
