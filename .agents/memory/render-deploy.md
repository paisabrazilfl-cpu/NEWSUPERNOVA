---
name: Render deployment
description: BOS-AURA service on Render — service IDs, URL, and pending DATABASE_URL setup
---

# Render Deployment — BOS-AURA

**Service:** `bos-aura`
**Service ID:** `srv-d8hmeunlk1mc73faoh90`
**URL:** `https://bos-aura.onrender.com`
**Dashboard:** `https://dashboard.render.com/web/srv-d8hmeunlk1mc73faoh90`
**Owner ID:** `tea-d8a836beo5us739g6cc0`
**Repo:** `https://github.com/paisabrazilfl-cpu/BOS-AURA`
**Auto-deploy:** yes (triggers on push to main branch)

**Build command:** `npm install -g pnpm@latest && pnpm install --frozen-lockfile=false && pnpm --filter @workspace/openclaw run build && pnpm --filter @workspace/api-server run build`
**Start command:** `node artifacts/api-server/dist/index.mjs`

**Env vars set:** NODE_ENV, PORT=10000, BASE_PATH=/, SESSION_SECRET (generated), FIRECRAWL_API_KEY

**Why DATABASE_URL is missing:** Render API's `fromDatabase` env var link requires the service and DB to be in the same Blueprint deployment. Setting it via PUT /env-vars with `fromDatabase: { databaseId: ... }` returns "missing environment variable value". Must be set manually in the Render dashboard or by connecting the openclaw-db (`dpg-d8epkei8qa3s73dpmcgg-a`) via the dashboard environment settings.

**openclaw-db:** `dpg-d8epkei8qa3s73dpmcgg-a` — existing Render PostgreSQL, plan=basic_256mb, region=oregon, databaseName=openclaw_db_te42

**How to apply:** When user reports Render deploy failing on DB connection, instruct them to go to Render dashboard → bos-aura service → Environment → Add DATABASE_URL linked to openclaw-db.

## Keep-alive (cold-start prevention)

The api-server self-pings its own `/api/healthz` on an interval to stop Render free/starter tier from spinning down after 15 min idle. Implemented in-process (setInterval, `timer.unref()`), only active when `NODE_ENV=production`.

- URL source: `KEEP_ALIVE_URL` override, else `RENDER_EXTERNAL_URL` (Render auto-injects this for web services — no manual setup needed on Render).
- Interval: `KEEP_ALIVE_INTERVAL_MS` (default 600000 = 10 min, under the 15-min idle window).
- Disable with `KEEP_ALIVE_DISABLED=true`.
- **Why in-process self-ping (not external cron):** Render free tier has no built-in cron; an inbound HTTP request (even self-originated via the public URL) resets the idle timer. No extra service/cost.
- If the user instead upgrades to a paid "Always On" plan, the self-ping is harmless but redundant.
