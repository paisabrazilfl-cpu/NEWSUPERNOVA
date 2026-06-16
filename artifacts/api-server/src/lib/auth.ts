import {
  createHmac,
  scryptSync,
  timingSafeEqual,
  randomBytes,
} from "node:crypto";
import type { Request, Response, NextFunction } from "express";

/**
 * Operator authentication for OPENCLAW OMEGA.
 *
 * Protected routes (currently the secrets vault) may only be reached by a
 * signed-in operator. An operator authenticates with a single shared password
 * (`OPERATOR_PASSWORD`). On success we mint a stateless, HMAC-signed session
 * token (signed with a key derived from `SESSION_SECRET`) and set it as an
 * HttpOnly cookie. Every protected request is re-validated against that token.
 *
 * We fail closed: if `OPERATOR_PASSWORD` or `SESSION_SECRET` is unset, no token
 * can ever be minted or verified, so protected routes reject every caller. The
 * vault is locked rather than silently open.
 */

export const SESSION_COOKIE = "openclaw_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60; // 12 hours

let cachedKey: Buffer | null = null;

/** Derive the signing key from SESSION_SECRET. Throws if it is unset. */
function getSigningKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env["SESSION_SECRET"];
  if (!secret) {
    throw new Error(
      "SESSION_SECRET is required for operator auth — refusing to operate without it.",
    );
  }
  cachedKey = scryptSync(secret, "openclaw-auth-v1", 32);
  return cachedKey;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function sign(payload: string): string {
  return createHmac("sha256", getSigningKey()).update(payload).digest("base64url");
}

/** True only when the configured operator password is present and matches. */
export function verifyPassword(provided: unknown): boolean {
  const expected = process.env["OPERATOR_PASSWORD"];
  if (!expected || typeof provided !== "string" || provided.length === 0) {
    return false;
  }
  return timingSafeStrEqual(provided, expected);
}

/**
 * Constant-time string comparison. Hashes both inputs to a fixed 32-byte digest
 * first, so neither length nor content leaks via timing (timingSafeEqual throws
 * on length mismatch, and a raw length check is itself a side channel). Use for
 * any secret/token/api-key comparison.
 */
export function timingSafeStrEqual(a: string, b: string): boolean {
  const ha = createHmac("sha256", TIMING_SALT).update(a).digest();
  const hb = createHmac("sha256", TIMING_SALT).update(b).digest();
  return timingSafeEqual(ha, hb);
}
const TIMING_SALT = randomBytes(32);

/** Mint a signed session token that expires after SESSION_TTL_SECONDS. */
export function issueSessionToken(): string {
  const payload = {
    sub: "operator",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    nonce: randomBytes(8).toString("hex"),
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/** Validate a session token's signature and expiry. */
export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  // Auth is only possible when a password is configured; without it, fail closed.
  if (!process.env["OPERATOR_PASSWORD"]) return false;

  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [body, mac] = parts;

  let expectedMac: string;
  try {
    expectedMac = sign(body);
  } catch {
    return false; // SESSION_SECRET missing → fail closed
  }

  const macBuf = Buffer.from(mac);
  const expBuf = Buffer.from(expectedMac);
  if (macBuf.length !== expBuf.length || !timingSafeEqual(macBuf, expBuf)) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      exp?: number;
      sub?: string;
    };
    if (payload.sub !== "operator") return false;
    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(Date.now() / 1000)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Build the Set-Cookie options for the session cookie. */
export function sessionCookieOptions(): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env["NODE_ENV"] === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS * 1000,
  };
}

/** Extract a session token from the cookie or an Authorization: Bearer header. */
function extractToken(req: Request): string | null {
  const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.[
    SESSION_COOKIE
  ];
  if (cookieToken) return cookieToken;
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, "");
  }
  return null;
}

/**
 * Express middleware that rejects any request lacking a valid operator session.
 * Responses are intentionally generic so anonymous callers learn nothing about
 * the protected resource (e.g. stored secret names).
 */
export function requireOperator(req: Request, res: Response, next: NextFunction): void {
  // Open-access mode: when embedded inside another trusted AI platform the
  // operator sign-in gate is disabled entirely (set OPEN_ACCESS=1).
  if (process.env["OPEN_ACCESS"] === "1") {
    next();
    return;
  }
  if (verifySessionToken(extractToken(req))) {
    next();
    return;
  }
  res.status(401).json({ error: "Unauthorized — operator sign-in required" });
}
