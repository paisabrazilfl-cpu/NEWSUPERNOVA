import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import helmet from "helmet";
import router from "./routes";
import { logger } from "./lib/logger";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const app: Express = express();

// Install common security headers. Helmet enables a baseline set of
// protections including X-DNS-Prefetch-Control, X-Frame-Options, Strict-
// Transport-Security, X-Content-Type-Options, and a sensible Content-Security-
// Policy. See https://expressjs.com/en/advanced/best-practice-security.html for
// guidance. Specific CSP tuning may still be needed for inline scripts or
// external assets.
app.use(helmet());

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// Configure Cross-Origin Resource Sharing. In production we fail closed: the
// ALLOWED_ORIGINS env var must be set to a comma-separated list of allowed
// origins. Without it, the server refuses to start to prevent a permissive
// wildcard CORS policy. In development or CI, when NODE_ENV !== production,
// the allowlist may be omitted and CORS will be fully open.
const allowedOrigins = (process.env["ALLOWED_ORIGINS"] ?? "")
  .split(",").map((o) => o.trim()).filter(Boolean);
const isProd = process.env["NODE_ENV"] === "production";
if (isProd && allowedOrigins.length === 0) {
  throw new Error(
    "ALLOWED_ORIGINS is required in production for a safe CORS policy",
  );
}
app.use(
  allowedOrigins.length > 0
    ? cors({ origin: allowedOrigins, credentials: true })
    : cors(),
);
app.use(cookieParser());
// Limit is generous so base64 image/file uploads (POST /api/uploads) fit; the
// upload route itself caps the decoded size at 20 MB.
app.use(express.json({ limit: "30mb" }));
app.use(express.urlencoded({ extended: true, limit: "30mb" }));

app.use("/api", router);

// Always-available health endpoint (used by Render / load-balancers).
app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", service: "supernova-api" });
});

// In production, serve the Vite-built frontend if it was bundled into the image.
const __filename_app = fileURLToPath(import.meta.url);
const __dirname_app = path.dirname(__filename_app);
const staticPath = path.join(__dirname_app, "..", "..", "openclaw", "dist", "public");
const indexHtml = path.join(staticPath, "index.html");
const hasFrontend =
  process.env["NODE_ENV"] === "production" && fs.existsSync(indexHtml);

if (hasFrontend) {
  // Per-deploy cache-busting version. Vite already content-hashes /assets/*, so
  // those auto-bust; this stamps ?v=<git-commit> onto FIXED-name public assets
  // (favicon, og image, manifest…) so a new build is a fresh URL for those too.
  // We deliberately EXCLUDE /assets/ to preserve their immutable caching (an
  // unchanged vendor chunk must not be forced to re-download every deploy).
  const BUILD_ID =
    (process.env["RENDER_GIT_COMMIT"] ?? "").slice(0, 8) ||
    (process.env["BUILD_ID"] ?? "") ||
    String(Date.now());
  let indexHtmlCache: string | null = null;
  const renderIndexHtml = (): string => {
    if (indexHtmlCache != null) return indexHtmlCache;
    const raw = fs.readFileSync(indexHtml, "utf8");
    indexHtmlCache = raw.replace(
      /((?:src|href)=")(\/(?!assets\/)[A-Za-z0-9_\-./]+\.(?:png|jpe?g|svg|webp|gif|ico|json|webmanifest|js|css|woff2?))(")/g,
      (_m, p1: string, url: string, p3: string) =>
        `${p1}${url}${url.includes("?") ? "&" : "?"}v=${BUILD_ID}${p3}`,
    );
    return indexHtmlCache;
  };

  app.use(
    express.static(staticPath, {
      index: false, // "/" is served by the SPA handler so it gets a stamped, no-cache shell
      setHeaders: (res, filePath) => {
        // The SPA entry point must NEVER be cached: the browser has to revalidate
        // it on every load so a new deploy is picked up immediately (otherwise a
        // tab keeps serving a stale bundle — the "old build" ghost). Hashed assets
        // are content-addressed (the filename changes when the bytes change), so
        // they're safe to cache forever.
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache");
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );
  app.get(/^(?!\/api).*/, (req, res, next) => {
    // Missing static assets (paths with a file extension) should 404, not
    // fall back to the SPA shell — otherwise stale asset requests get HTML 200.
    if (path.extname(req.path)) return next();
    // The SPA shell is served for every app route; it must revalidate too so a
    // deep-link/refresh always lands the newest deployed bundle.
    res.setHeader("Cache-Control", "no-cache");
    res.type("html").send(renderIndexHtml());
  });
} else {
  // No frontend bundle (dev, or build missing) — expose a health root.
  app.get("/", (_req, res) => {
    res.json({ status: "ok", service: "supernova-api" });
  });
}

export default app;
