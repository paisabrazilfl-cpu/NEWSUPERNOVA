# OPENCLAW OMEGA

A Discord-style multi-agent AI orchestrator dashboard for monitoring and directing ABBY CLAW autonomous agents in real-time.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/openclaw run dev` — run the frontend dashboard
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (port 8080, path `/api`)
- DB: PostgreSQL + Drizzle ORM
- Frontend: React + Vite + Tailwind (port 20581, path `/`)
- Validation: Zod (`zod/v4` in libs, plain `zod` in api-server routes)
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Animations: framer-motion

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI source of truth
- `lib/db/src/schema/` — Drizzle table definitions (agents, channels, messages, tasks, telemetry)
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/openclaw/src/` — React frontend
  - `components/dashboard/SwarmCanvas.tsx` — Animated agent node graph
  - `components/dashboard/AgentInspector.tsx` — Right-side telemetry drawer
  - `components/dashboard/ChatStream.tsx` — Color-coded agent message feed
  - `components/dashboard/CommandBar.tsx` — Bottom command bar with @-routing

## Architecture decisions

- SVG `transform` cannot use percentage values — use `viewBox="-500 -400 1000 800"` + CSS positioned divs for agent nodes
- Backend route files must NOT import `zod/v4` directly (esbuild can't resolve it); use plain `zod` or validate without zod in api-server routes
- Agent telemetry (monologue + tool calls) stored in separate `monologue_lines` and `tool_calls` tables, served under `/api/agents/:id/telemetry`
- Swarm pause/resume state is held in-memory on the API server (not persisted) — resets on restart

## Product

- **Swarm Canvas** — Animated node-graph of all ABBY CLAW agents with neon glow, pulse animations per status (thinking=green, waiting=blue, hitl=purple, idle=gray), animated connection lines between active agents
- **Chat Stream** — Discord-style scrollable message feed, color-coded by agent, special rendering for tool_output (code blocks) and hitl_request (pulsing purple + Authorize button)
- **Inspector Drawer** — Click any agent node to slide in a right panel showing internal monologue terminal, tool call execution matrix, context window gauge
- **Command Bar** — Global broadcast or `@AgentName` targeted routing, Tab cycles agents, Pause/Resume SWARM button
- **Agents page** — Full agent registry with status badges, capabilities, model info
- **Tasks page** — Task queue with priority badges, progress bars, agent assignments

## ABBY CLAW Agents

| Name | Role | Model | Color |
|------|------|-------|-------|
| ABBY | Orchestrator | hermes-3-70b | #00e5ff |
| CLAW-1 | Code Executor | qwen2.5-coder-32b | #bf00ff |
| CLAW-2 | Browser Agent | gpt-4o | #0066ff |
| CLAW-3 | Memory & RAG | llama-3.3-70b | #00cc88 |
| CLAW-4 | API Connector | claude-3-5-sonnet | #ff6b00 |
| MR.NICE | Social Agent | mistral-large | #ff2d78 |

## User preferences

- Do not ask to fix things that can be self-fixed — self-reflect, plan, execute, verify
- Keep the cyberpunk dark aesthetic: zinc-950 background, neon cyan/purple accents

## OpenRouter AI Integration

- `OPENROUTER_API_KEY` — stored as a shared env var
- Base URL: `https://openrouter.ai/api/v1` — OpenAI-compatible with streaming SSE
- Backend routes: `POST /api/ai/chat` (SSE streaming), `POST /api/ai/complete` (non-streaming), `GET /api/ai/models`
- Each agent has a cyberpunk persona system prompt in `artifacts/api-server/src/routes/ai.ts`
- Client hook: `artifacts/openclaw/src/hooks/useAiStream.ts` — fetch-based SSE reader with abort, clear, token accumulation
- CommandBar CHAT tab has `AI ON/OFF` toggle — when ON, sending a message triggers a streaming AI response from the targeted agent
- Streaming tokens appear live in a banner above the input (agent-colored neon border + cursor blink)
- On completion, full response is saved to the `messages` table and ChatStream picks it up via polling

**Agent → Model mapping:**
| Agent | Model |
|-------|-------|
| ABBY | `x-ai/grok-4.3` |
| FORGE | `qwen/qwen3.7-plus` |
| CRAWLER | `x-ai/grok-build-0.1` |
| VAULT | `qwen/qwen3.7-max` |
| WIRE | `x-ai/grok-4.20` |
| MR.NICE | `qwen/qwen3.6-plus` |

## Steel Dev Browser API

- `STEEL_API_KEY` — stored as a shared env var
- API proxy at `/api/steel/` routes to `https://api.steel.dev/v1/`
- Endpoints: `GET/POST /api/steel/sessions`, `DELETE /api/steel/sessions/:id`, `POST /api/steel/scrape`, `POST /api/steel/screenshot`, `POST /api/steel/pdf`
- Session object: `{ id, status, debugUrl (player iframe), sessionViewerUrl (Steel UI), websocketUrl, creditsUsed }`
- Frontend panel: click **STEEL** tab in LeftPanel toggle → `SteelBrowser.tsx` component
  - **LIVE VIEW** tab — embeds `session.debugUrl` as an iframe for real-time browser viewing
  - **SCRAPED** tab — shows extracted content from `/api/steel/scrape`
  - **SCREENSHOT** tab — shows full-page capture from `/api/steel/screenshot`
- CRAWLER agent (id=3, color=#0066ff) is the designated browser agent for Steel sessions
- CommandBar presets include `steel_browser:`, `steel_scrape:`, `steel_screenshot:`, `steel_pdf:` commands

## Gotchas

- Do NOT use `zod/v4` imports in `artifacts/api-server/src/` — esbuild can't resolve the subpath. Use `zod` or avoid zod entirely
- SVG `<g transform="translate(50%, 50%)">` is invalid — percentages not supported in SVG transforms. Use `viewBox` + CSS `flex items-center justify-center` for centering
- Always run codegen after OpenAPI spec changes before building frontend
- Swarm status aggregation uses raw SQL via `drizzle-orm/sql` — ensure imports include `sql` from `drizzle-orm`

## Official Social API Connectors

- The safe/legal way for agents to act on a user's social account: **official APIs via Replit-managed OAuth** (NOT browser username/password login — refused, ToS + ban risk even for owned accounts)
- `artifacts/api-server/src/lib/connectors.ts` — platform registry + Replit connector-proxy token fetch (token minted at request time, never persisted, scrubbed from responses)
- Supported platforms (first-party account connectors): `instagram`, `facebook`, `x`, `reddit`, `youtube`, `tiktok`. **LinkedIn has no first-party account connector** (only third-party prospecting tools)
- Agent tools: `social_accounts` (lists connected platforms) and `social_api` (calls the official API). Granted to ABBY, CRAWLER, WIRE, MR.NICE
- Each platform requires a one-time OAuth authorize by the operator via the integration flow; `proposeIntegration` exits the agent loop, so platforms are authorized one at a time

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
