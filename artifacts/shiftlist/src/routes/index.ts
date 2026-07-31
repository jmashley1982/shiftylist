import { Router, type IRouter } from "express";
import { STAFF_BASE, ADMIN_BASE } from "../lib/urls.js";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import staffRouter from "./staff.js";
import adminRouter from "./admin.js";

/**
 * Everything is mounted under /staff or /admin/shifts — the only two path
 * prefixes routed to this Worker on vikingvaporandsmoke.com. See
 * src/lib/urls.ts for why that matters.
 */
const router: IRouter = Router();

router.use(STAFF_BASE, healthRouter);
router.use(STAFF_BASE, authRouter);
router.use(STAFF_BASE, staffRouter);
router.use(ADMIN_BASE, adminRouter);

export default router;
