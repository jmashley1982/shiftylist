import type { Request, Response, NextFunction } from "express";
import { staffUrl, VIKING_LOGIN } from "../lib/urls.js";
import { checkVikingSession } from "./vikingAuth.js";

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
  checkVikingSession(req)
    .then((result) => {
      if (result === "ok") {
        next();
        return;
      }
      // The reason rides along in the address bar (the ordering SPA ignores
      // unknown query params), so a misconfigured deployment can be
      // diagnosed by reading the URL after the bounce instead of guessing.
      res.redirect(`${VIKING_LOGIN}?shift_auth=${result}`);
    })
    .catch(next);
}
