import type { RequestHandler } from "express";
import { logger } from "./logger.js";

/**
 * Request logging, replacing pino-http. Emits the same fields its serializers
 * produced (method, path without query, status) plus the duration.
 */
export function httpLogger(): RequestHandler {
  return (req, res, next) => {
    const start = Date.now();

    res.on("finish", () => {
      logger.info(
        {
          req: { method: req.method, url: req.originalUrl.split("?")[0] },
          res: { statusCode: res.statusCode },
          ms: Date.now() - start,
        },
        "request completed",
      );
    });

    next();
  };
}
