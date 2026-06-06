---
name: operator-auth
description: How operator sign-in protects api-server routes (the secrets vault) and why web auth here is cookie-based.
---

# Operator authentication

Protected api-server routes (currently `/api/vault*`) require a signed-in operator. Auth is a single shared-password login, not a multi-user system.

## Model

- Login (`POST /api/auth/login`) checks the submitted password against `OPERATOR_PASSWORD` with a timing-safe compare, then mints a **stateless HMAC-signed session token** (key = `scryptSync(SESSION_SECRET, "openclaw-auth-v1")`) and sets it as an HttpOnly `openclaw_session` cookie (SameSite=Lax, Secure in prod). No server-side session store.
- `requireOperator` middleware validates the token from the cookie OR an `Authorization: Bearer` header, checks signature + expiry, and 401s otherwise.
- `GET /api/auth/me` reports `{ authenticated }`; `POST /api/auth/logout` clears the cookie.

## Don't regress these

- **Fail closed.** If `OPERATOR_PASSWORD` or `SESSION_SECRET` is unset, no token can be minted or verified → every protected route 401s. The vault locks rather than silently opening. (Mirrors the vault's own fail-closed key derivation.)
- **Generic 401 bodies.** The unauthorized response must never leak protected-resource details (e.g. secret names) to anonymous callers.

## Why web auth is cookie-based here

The frontend and `/api` are same-origin (Replit proxy in dev, the same Express server serving static + API in prod), so the browser auto-sends the session cookie — the generated `customFetch` mutator needs no `credentials`/token wiring on web. The `setAuthTokenGetter` Bearer path in `custom-fetch.ts` is for Expo/remote bundles only; the middleware accepts Bearer too so curl/tests can authenticate with a minted token.
