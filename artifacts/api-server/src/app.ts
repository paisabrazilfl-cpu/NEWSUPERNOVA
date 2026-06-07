import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const app: Express = express();

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
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Always-available health endpoint (used by Render / load-balancers).
app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", service: "bos-aura-api" });
});

// In production, serve the Vite-built frontend if it was bundled into the image.
const __filename_app = fileURLToPath(import.meta.url);
const __dirname_app = path.dirname(__filename_app);
const staticPath = path.join(__dirname_app, "..", "..", "openclaw", "dist", "public");
const indexHtml = path.join(staticPath, "index.html");
const hasFrontend =
  process.env["NODE_ENV"] === "production" && fs.existsSync(indexHtml);

if (hasFrontend) {
  app.use(express.static(staticPath));
  app.get("/*path", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    // Missing static assets (paths with a file extension) should 404, not
    // fall back to the SPA shell — otherwise stale asset requests get HTML 200.
    if (path.extname(req.path)) return next();
    res.sendFile(indexHtml, (err) => {
      if (err) next();
    });
  });
} else {
  // No frontend bundle (dev, or build missing) — expose a health root.
  app.get("/", (_req, res) => {
    res.json({ status: "ok", service: "bos-aura-api" });
  });
}

export default app;
