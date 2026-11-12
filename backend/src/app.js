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
const smallJson = express.json({ limit: "32kb" }),
  paperJson = express.json({ limit: "2mb" });
app.use((req, res, next) => {
  if (/^\/api\/examiner\/papers\/[^/]+$/.test(req.path) && req.method === "PUT")
    return paperJson(req, res, next);
  return smallJson(req, res, next);
});
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
  express.static(path.join(root, "public"), {
    extensions: ["html"],
    maxAge: 0,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) res.set("Cache-Control", "no-store");
      else if (
        filePath.startsWith(path.join(root, "public", "assets") + path.sep) &&
        /-[A-Za-z0-9_-]{8,}\.(?:js|css|jpe?g|png|svg|webp|woff2?)$/.test(
          path.basename(filePath),
        )
      )
        res.set("Cache-Control", "public, max-age=31536000, immutable");
    },
  }),
);
app.use((req, res) =>
  res.status(404).json({ error: "Page or endpoint not found." }),
);
app.use(errorHandler);
export default app;
