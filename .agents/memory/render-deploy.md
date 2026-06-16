````md id="render-deployment-newsupernova"

# Render Deployment — NEWSUPERNOVA

**service:** newsupernova  
**service_id:** srv-d8hmeunlk1mc73faoh90  
**url:** https://newsupernova.onrender.com  
**dashboard:** https://dashboard.render.com/web/srv-d8hmeunlk1mc73faoh90  
**owner_id:** tea-d8a836beo5us739g6cc0  
**repo:** https://github.com/paisabrazilfl-cpu/NEWSUPERNOVA  
**auto_deploy:** true (branch: main)

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
   [https://dashboard.render.com/web/srv-d8hmeunlk1mc73faoh90](https://dashboard.render.com/web/srv-d8hmeunlk1mc73faoh90)

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
