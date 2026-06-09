import express, { type Express } from "express";
import pinoHttp from "pino-http";
import session from "express-session";
import { fileURLToPath } from "url";
import path from "path";
import router from "./routes/index.js";
import { logger } from "./lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viewsDir = path.join(__dirname, "../views");
const publicDir = path.join(__dirname, "../public");

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  })
);

app.set("view engine", "ejs");
app.set("views", viewsDir);

app.use(express.static(publicDir));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const secret = process.env["SESSION_SECRET"];
if (!secret) {
  logger.warn("SESSION_SECRET not set — using insecure default");
}

app.use(
  session({
    secret: secret ?? "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 8 * 60 * 60 * 1000 },
  })
);

app.use(router);

export default app;
