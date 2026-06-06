---
name: Steel browser live view
description: Constraints and known limitations of the Steel.dev live browser embed
---

# Steel browser live view

## Live WebRTC stream (WHEP) is currently broken / plan-limited
The embedded live-view player (`debugUrl` = `api.steel.dev/v1/sessions/<id>/player`)
fails to connect with **WHEP 400 "Invalid live-stream request"** for BOTH default
1920x1080 and custom-sized sessions. Proven dimension-independent in a real browser.

**Why it matters:** this is a Steel-side / account-plan limitation, NOT a bug in
our code or iframe. Real Steel **scrape** and **screenshot** still work (the
orchestrator uses scrape successfully). Don't chase this as a frontend/iframe bug.
**How to apply:** if live view shows "Browser Disconnected", verify Steel's
streaming/live-view entitlement on the account before touching our code.

## /scrape `content` may be an object, not a string
Steel's `/scrape` can return `content` as `{ html, markdown, text }` (not a plain
string). Rendering it directly in React throws
**"Objects are not valid as a React child (found: object with keys {html})"** and
blanks the whole panel.
**Why it matters:** the server passes Steel's raw JSON straight through, so the
client must coerce. **How to apply:** always flatten scrape payloads to strings
(prefer markdown > text > content > html, else JSON.stringify) before storing in
state / rendering.

## Session viewport must match the embedding container
`POST /api/steel/sessions` accepts `dimensions:{width,height}`; the client measures
its panel and passes it so the live player fills the container instead of floating a
fixed 1920x1080 window. Dimensions are clamped (640-1920 x 480-1200) and **forced
even** — the H.264 encoder rejects odd width/height. Keep dimensions even.
