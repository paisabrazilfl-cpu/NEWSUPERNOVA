# Voice control via Vapi — phone the swarm and run it

BOS-AURA can be driven entirely by a phone call through [Vapi](https://vapi.ai):
talk to ABBY, dispatch real orchestrated tasks, and hear the results back.
Two server pieces power it, both under the existing external API auth:

| Piece | Endpoint | Purpose |
| --- | --- | --- |
| Conversation | `POST /api/external/v1/chat/completions` | OpenAI-compatible (SSE streaming) — Vapi's "Custom LLM" talks to an agent directly |
| Actions | `POST /api/external/v1/vapi/webhook` | Vapi tool server — `dispatch_task`, `check_status`, `get_last_result` |

## 0. Prerequisites

- `OPENCLAW_API_KEY` set on the Render service. **Without it the external API
  is open to anyone** — never wire telephony to an unauthenticated swarm.
- A Vapi account; a free Vapi phone number or an imported Twilio number.

## 1. Create the assistant (Vapi dashboard)

**Model:** provider **Custom LLM**
- URL: `https://bos-aura.onrender.com/api/external/v1` (Vapi appends `/chat/completions`)
- Model: `abby` (or `forge`, `crawler`, `vault`, `wire`, `mr.nice`)
- Credential/API key: the `OPENCLAW_API_KEY` value (sent as `Authorization: Bearer …`)

**System prompt (recommended):** add something like
> You are on a live phone call. Answer in one or two short sentences. When the
> caller asks you to DO something (research, build, post, schedule), call the
> dispatch_task tool with their request — don't try to do the work in the
> conversation. Use check_status and get_last_result when asked for progress.

**Transcriber + Voice:** any (Deepgram + ElevenLabs work well).

## 2. Add the custom tools

Create three **custom tools** (Dashboard → Tools), all with:
- Server URL: `https://bos-aura.onrender.com/api/external/v1/vapi/webhook`
- Server secret: the `OPENCLAW_API_KEY` value (Vapi sends it as `x-vapi-secret`,
  which the API accepts alongside `Authorization`/`x-api-key`).

| Tool name | Parameters | What it does |
| --- | --- | --- |
| `dispatch_task` | `task` (string, required), `priority` (`normal`\|`high`) | Hands the goal to ABBY's orchestrator — the same real multi-CLAW machinery as the dashboard, including the solve loop. Connected-account goals ("post to my Instagram…") are auto-routed to WIRE exactly once. Returns immediately; work continues in the background. |
| `check_status` | none | Voice-sized summary: which agents are busy, running tasks, recently completed. |
| `get_last_result` | none | ABBY's most recent final briefing, stripped of markdown for speech. |

Attach all three tools to the assistant, then attach a phone number to the
assistant.

## 3. Call it

- "Have the swarm research the top three AI voice platforms and compare pricing."
  → assistant calls `dispatch_task` → ABBY orchestrates for real.
- "What's the status?" → `check_status`.
- "Read me the result." → `get_last_result`.

Because dispatch is fire-and-forget, long tasks finish after you hang up —
call back (or stay on the line) and ask for the result.

## Notes / limits

- **Render cold starts:** a spun-down service answers the first webhook slowly;
  keep the instance warm or expect an initial pause.
- The webhook acknowledges Vapi's non-tool server messages (status updates,
  end-of-call reports) with an empty `results` array so nothing is retried.
- Payload contract pinned by `external.vapi.test.ts`; format per
  [docs.vapi.ai/tools/custom-tools](https://docs.vapi.ai/tools/custom-tools)
  (verified 2026-06-11), with tolerance for the OpenAI-shaped variants.
