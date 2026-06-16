````md id="render-deployment-supernova"

# Render Deployment — NEWSUPERNOVA

**service:** supernova  
**service_id:** srv-d8om1j7lk1mc739ed5ig  
**url:** https://supernova-ekbj.onrender.com  (the `supernova` subdomain was taken globally, so Render assigned the `-ekbj` suffix)  
**dashboard:** https://dashboard.render.com/web/srv-d8om1j7lk1mc739ed5ig  
**db:** supernova-db (dpg-d8om025ckfvc73ftip40-a, basic_256mb, oregon) — dedicated, not shared with bos-aura  
**owner_id:** tea-d8a836beo5us739g6cc0  
**repo:** https://github.com/paisabrazilfl-cpu/NEWSUPERNOVA  
**auto_deploy:** true (branch: ai/2026-06-16-github-render-supernova-deploy)

## Key management (clean slate)

Provider/integration API keys are **operator-managed in the app**: Settings →
Vault (`PUT /api/vault`, encrypted in DB, loaded into env at boot; explicit env
vars win). NO provider keys are baked into the Render env.

Render env holds ONLY non-secret config + boot/auth essentials:
`NODE_ENV, PORT, BASE_PATH, ALLOWED_ORIGINS, PUBLIC_BASE_URL, DATABASE_URL,
SESSION_SECRET, OPERATOR_PASSWORD`.

PROTECTED (vault refuses them — set via Render env only if needed):
`OPERATOR_PASSWORD, SESSION_SECRET, OPENCLAW_API_KEY, DATABASE_URL, NODE_ENV,
PATH, PORT, BASE_PATH, ALLOW_COMPOSIO_EXECUTE`. `OPENCLAW_API_KEY` (external/
swarm API auth) was intentionally wiped; add it in the Render dashboard if the
external API / Nova- swarm integration is needed.

---

# build configuration

```bash
build_command:
pnpm install && pnpm build

start_command:
node artifacts/api-server/dist/index.mjs
````

---

# environment variables

```env
NODE_ENV=production
PORT=10000
BASE_PATH=/
SESSION_SECRET=generated
FIRECRAWL_API_KEY=***set***

# DATABASE (pending manual hookup)
DATABASE_URL=NOT_SET
```

---

# database configuration

## postgres instance

```
openclaw-db
id: dpg-d8epkei8qa3s73dpmcgg-a
region: oregon
plan: basic_256mb
database: openclaw_db_te42
```

---

# deployment constraint (CRITICAL)

Render API limitation:

* `fromDatabase` env linking is NOT reliably supported via API
* DATABASE_URL must be set manually in dashboard OR Blueprint-linked deployment

---

# fix procedure (authoritative)

1. open:
   [https://dashboard.render.com/web/srv-REPLACE_WITH_NEW_SUPERNOVA_SERVICE_ID](https://dashboard.render.com/web/srv-REPLACE_WITH_NEW_SUPERNOVA_SERVICE_ID)

2. go to:
   Environment → Add Variable

3. set:

```env
DATABASE_URL=<linked openclaw-db connection string>
```

---

# keep-alive system

```ts
setInterval(() => {
  fetch(process.env.RENDER_EXTERNAL_URL + "/api/healthz").catch(() => {});
}, 600000).unref();
```

---

# invariant

* service is considered "live" only if `/api/healthz` returns 200
* DATABASE_URL missing = runtime degraded state (not deployed failure)
* auto-deploy triggers only on `main`

---

# runtime note

Render free/starter instances may sleep after inactivity unless:

* keep-alive is enabled
* or plan is upgraded to always-on

---

```
```
