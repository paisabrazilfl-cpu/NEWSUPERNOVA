
import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import express from "express";
import cookieParser from "cookie-parser";

/* =========================
   ENV CONFIG (FAIL CLOSED)
========================= */

const OPERATOR_PASSWORD = process.env.OPERATOR_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!OPERATOR_PASSWORD || !SESSION_SECRET) {
  console.error("[AUTH_FATAL] Missing OPERATOR_PASSWORD or SESSION_SECRET");
}

/* =========================
   HMAC SESSION SIGNING
========================= */

const key = crypto.scryptSync(SESSION_SECRET ?? "", "openclaw-auth-v1", 32);

function signSession(payload: object) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");

  const sig = crypto
    .createHmac("sha256", key)
    .update(data)
    .digest("base64url");

  return `${data}.${sig}`;
}

function verifySession(token: string) {
  const [data, sig] = token.split(".");

  if (!data || !sig) return null;

  const expected = crypto
    .createHmac("sha256", key)
    .update(data)
    .digest("base64url");

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    return null;
  }
}

/* =========================
   AUTH MIDDLEWARE
========================= */

export function requireOperator(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const cookieToken = req.cookies?.openclaw_session;
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : null;

  const token = cookieToken || bearer;

  if (!token) {
    return res.status(401).json({ authenticated: false });
  }

  const session = verifySession(token);

  if (!session) {
    return res.status(401).json({ authenticated: false });
  }

  (req as any).operator = session;

  next();
}

/* =========================
   ROUTES
========================= */

export const authRouter = express.Router();

authRouter.use(cookieParser());

/* LOGIN */
authRouter.post("/api/auth/login", (req, res) => {
  if (!OPERATOR_PASSWORD || !SESSION_SECRET) {
    return res.status(500).json({ error: "auth_not_configured" });
  }

  const { password } = req.body;

  const ok =
    password &&
    crypto.timingSafeEqual(
      Buffer.from(password),
      Buffer.from(OPERATOR_PASSWORD)
    );

  if (!ok) {
    return res.status(401).json({ authenticated: false });
  }

  const token = signSession({
    role: "operator",
    iat: Date.now(),
  });

  res.cookie("openclaw_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return res.json({ authenticated: true });
});

/* ME */
authRouter.get("/api/auth/me", requireOperator, (req, res) => {
  res.json({
    authenticated: true,
    operator: (req as any).operator,
  });
});

/* LOGOUT */
authRouter.post("/api/auth/logout", (_req, res) => {
  res.clearCookie("openclaw_session");
  res.json({ authenticated: false });
});
