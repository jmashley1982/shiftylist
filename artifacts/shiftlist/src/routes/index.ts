import { Router, type IRouter } from "express";
import { STAFF_BASE, ADMIN_BASE } from "../lib/urls.js";
import { ensureAdminAuth } from "../middleware/auth.js";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import staffRouter from "./staff.js";
import adminRouter from "./admin.js";
import companyAdminRouter from "./companyAdmin.js";

/**
 * Everything is mounted under /staff or /admin/shifts — the only two path
 * prefixes routed to this Worker on vikingvaporandsmoke.com. See
 * src/lib/urls.ts for why that matters.
 */
const router: IRouter = Router();

router.use(STAFF_BASE, healthRouter);
router.use(STAFF_BASE, authRouter);
router.use(STAFF_BASE, staffRouter);
// The Company Board's manager side is a sibling of adminRouter, not a child,
// so it needs ensureAdminAuth applied here — admin.ts's router-wide guard
// does not reach it. Mounted first so its paths win.
router.use(`${ADMIN_BASE}/company`, ensureAdminAuth, companyAdminRouter);
router.use(ADMIN_BASE, adminRouter);

export default router;
