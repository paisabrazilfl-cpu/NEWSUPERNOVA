import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import path from "path";
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

// Health check — always responds 200 so Render / load-balancers pass
app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "bos-aura-api" });
});

// In production, serve the Vite-built frontend as static files if present
if (process.env["NODE_ENV"] === "production") {
  const __filename_app = fileURLToPath(import.meta.url);
  const __dirname_app = path.dirname(__filename_app);
  const staticPath = path.join(__dirname_app, "..", "..", "openclaw", "dist", "public");
  const indexHtml = path.join(staticPath, "index.html");
  app.use(express.static(staticPath));
  app.get("/*path", (_req, res, next) => {
    res.sendFile(indexHtml, (err) => {
      if (err) next();
    });
  });
}

export default app;
