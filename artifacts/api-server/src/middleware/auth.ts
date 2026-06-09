import type { Request, Response, NextFunction } from "express";

export function ensureStaffAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session.employeeId) {
    next();
    return;
  }
  res.redirect("/login");
}

export function ensureAdminAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session.isAdmin) {
    next();
    return;
  }
  res.redirect("/admin/login");
}
