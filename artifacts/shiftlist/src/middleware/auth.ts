import type { Request, Response, NextFunction } from "express";
import { staffUrl, VIKING_LOGIN } from "../lib/urls.js";
import { hasValidVikingSession } from "./vikingAuth.js";

export function ensureStaffAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session.employeeId) {
    next();
    return;
  }
  res.redirect(staffUrl());
}

/**
 * Admin access rides on the Viking ordering app's session cookie — see
 * vikingAuth.ts. There is no ShiftList admin login anymore.
 */
export function ensureAdminAuth(req: Request, res: Response, next: NextFunction): void {
  hasValidVikingSession(req)
    .then((valid) => {
      if (valid) {
        next();
        return;
      }
      res.redirect(VIKING_LOGIN);
    })
    .catch(next);
}
