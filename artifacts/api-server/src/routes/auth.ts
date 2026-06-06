import { Router } from "express";
import {
  SESSION_COOKIE,
  issueSessionToken,
  sessionCookieOptions,
  verifyPassword,
  verifySessionToken,
} from "../lib/auth";

const router = Router();

// Sign in as an operator. Issues an HttpOnly session cookie on success.
router.post("/auth/login", (req, res) => {
  const password = (req.body as { password?: unknown } | undefined)?.password;
  if (!verifyPassword(password)) {
    res.status(401).json({ error: "Invalid operator password" });
    return;
  }
  const token = issueSessionToken();
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions());
  res.status(200).json({ authenticated: true });
});

// Sign out — clears the session cookie.
router.post("/auth/logout", (_req, res) => {
  const opts = sessionCookieOptions();
  res.clearCookie(SESSION_COOKIE, { ...opts, maxAge: undefined });
  res.status(200).json({ authenticated: false });
});

// Report whether the caller currently holds a valid operator session.
router.get("/auth/me", (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  res.status(200).json({ authenticated: verifySessionToken(token) });
});

export default router;
