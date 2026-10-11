import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { router } from "./routes/api.js";
import { csrfGuard, errorHandler } from "./middleware/security.js";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const app = express();
app.disable("x-powered-by");
// Vercel supplies the immediate trusted proxy; do not trust arbitrary forwarding chains.
if (process.env.VERCEL) app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests:
          process.env.NODE_ENV === "production" ? [] : null,
      },
    },
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "32kb" }));
app.use(
  "/api",
  (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  },
  csrfGuard,
  router,
);
// All data APIs enforce authorization. HTML shells contain no private data.
app.use(
  "/assets/bootstrap",
  express.static(path.join(root, "node_modules/bootstrap/dist"), {
    maxAge: "1d",
  }),
);
app.use(
  express.static(path.join(root, "frontend"), {
    extensions: ["html"],
    maxAge: 0,
  }),
);
app.use((req, res) =>
  res.status(404).json({ error: "Page or endpoint not found." }),
);
app.use(errorHandler);
export default app;
