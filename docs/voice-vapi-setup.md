# Voice control via Vapi — phone the swarm and run it

BOS-AURA can be driven entirely by a phone call through [Vapi](https://vapi.ai):
talk to ABBY, dispatch real orchestrated tasks, and hear the results back.

**Voice mode is self-contained in the custom-LLM endpoint.** Vapi includes the
live `call` object in every custom-LLM request; when a call id is present:

- **One dashboard chat per call** — a `voice-<MMDD-HHmm>` channel is created
  for the call, the live transcript (caller + ABBY + tool actions) is logged
  into it, and tasks dispatched during the call report their results there.
- **Tools run inline** — `dispatch_task`, `check_status` and `get_last_result`
  are offered to the model and executed by this server inside the same
  request, then the confirmation is spoken in the same breath. The separate
  Vapi tool-server round trip is NOT needed for the voice loop, so a missing
  tool secret can never silence the agent mid-call.

| Piece | Endpoint | Purpose |
| --- | --- | --- |
| Conversation + actions | `POST /api/external/v1/chat/completions` | OpenAI-compatible (SSE streaming) — Vapi's "Custom LLM"; voice mode handles the swarm tools inline |
| Call lifecycle (optional) | `POST /api/external/v1/vapi/webhook` | end-of-call summary into the call's channel; also still serves the legacy custom tools |

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

## 2. Tools — built in, nothing to attach

The three swarm tools are offered to the model and executed **inline by the
server** whenever the request belongs to a live call:

| Tool name | Parameters | What it does |
| --- | --- | --- |
| `dispatch_task` | `task` (string, required), `priority` (`normal`\|`high`) | Hands the goal to ABBY's orchestrator — the same real multi-CLAW machinery as the dashboard, including the solve loop. Connected-account goals ("post to my Instagram…") are auto-routed to WIRE exactly once. Results report into the call's own channel. |
| `check_status` | none | Voice-sized summary: which agents are busy, running tasks, recently completed. |
| `get_last_result` | none | ABBY's most recent final briefing, stripped of markdown for speech. |

Do **not** attach separate custom tools to the assistant — the inline path
replaces them. (The webhook still serves the same tools for any legacy
configuration that has them attached with a valid server secret.)

**Optional — call-end summaries:** set the assistant's *Server URL* to
`https://bos-aura.onrender.com/api/external/v1/vapi/webhook` with server
secret = `OPENCLAW_API_KEY` and enable the `end-of-call-report` server
message. The call's channel then gets a final "📞 Call ended" summary.

Attach a phone number to the assistant and you're done.

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
