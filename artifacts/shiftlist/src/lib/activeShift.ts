import { pool } from "../db/index.js";
import { logger } from "./logger.js";
import { getBusinessDayStr } from "../utils/dateHelpers.js";
import type { Request } from "express";

/**
 * Re-attaches a staff member to the shift they were already working.
 *
 * A login session is a cookie; the shift someone is mid-way through is a row
 * in `active_sessions`, written when they picked it and deleted when they
 * submit. Those two used to be tied together: lose the cookie mid-shift —
 * expiry, a new phone, a cleared browser — and the app sent them back to the
 * "Which shift are you working today?" screen with nothing to say which one
 * they had been on. Pick the wrong one and their checklist reads empty,
 * because completions are keyed by shift, not by person.
 *
 * So on any login that lands without a shift, look for one still open for
 * today's business day and put them back on it. Returns the shift id if it
 * restored one.
 */
export async function restoreActiveShift(req: Request): Promise<number | null> {
  if (req.session.selectedShiftId) return req.session.selectedShiftId;
  if (!req.session.employeeId) return null;

  try {
    const res = await pool.query<{ shift_id: number }>(
      `SELECT shift_id FROM active_sessions WHERE employee_id = $1 AND date = $2`,
      [req.session.employeeId, getBusinessDayStr()]
    );
    const shiftId = res.rows[0]?.shift_id;
    if (!shiftId) return null;

    req.session.selectedShiftId = shiftId;
    // Persist now rather than leaving it to express-session's end-of-response
    // save: a deferred save makes express-session hold back the response's
    // final byte until the store answers, and workerd's HTTP bridge drops that
    // byte — which corrupts JSON responses (see PgSessionStore.touch). Saving
    // here means the response-time save has nothing left to do.
    await new Promise<void>((resolve) => {
      req.session.save((err) => {
        if (err) logger.error({ err }, "Failed to persist a restored shift");
        resolve();
      });
    });
    logger.info(
      { employeeId: req.session.employeeId, shiftId },
      "Restored an in-progress shift after a lost session"
    );
    return shiftId;
  } catch (err) {
    // Non-fatal: they just get the shift picker, same as before.
    logger.error({ err }, "Failed to restore an in-progress shift");
    return null;
  }
}
