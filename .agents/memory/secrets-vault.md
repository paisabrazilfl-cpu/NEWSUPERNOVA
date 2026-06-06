---
name: secrets-vault
description: Security model and non-obvious constraints for the OPENCLAW encrypted secrets vault and how agents consume secrets.
---

# Secrets vault security model

The vault exists specifically because chat is persisted to the DB **and** sent to the LLM — pasting a credential into chat leaks it. So secrets must never travel through chat, model context, message log, or tool-call telemetry.

## Non-obvious constraints (don't regress these)

- **Resolve placeholders only at the moment of use.** Agents reference secrets as `{{secret:NAME}}`. The literal placeholder is what gets stored in `tool_calls.args` / telemetry; the raw value is substituted in-memory right before the outbound fetch. Storing the resolved value anywhere defeats the whole feature.
- **Redact reflected secrets from tool results.** An endpoint can echo your request back (echo/debug APIs, verbose error bodies, auth introspection). The orchestrator persists `toolResult` to `tool_calls.result`, a `tool_output` message, AND the next model turn. So any value injected into an `http_request` must be stripped back out of the response before returning. Track injected values (the `used` set in `substituteSecrets`) and run `redactSecrets` on the response + error string.
  **Why:** without this, a single echo endpoint reflects the secret straight into the model context and DB — the exact leak the vault was built to prevent.
  **How to apply:** any NEW tool that consumes secrets must do the same collect-then-redact, not just `http_request`.
- **Fail closed on the encryption key.** Key = `scryptSync(SESSION_SECRET, ...)`. There is intentionally NO insecure default — if `SESSION_SECRET` is unset, vault ops throw. Rotating `SESSION_SECRET` permanently invalidates all stored secrets (can't decrypt).
- **Write-only API.** No route or tool ever returns a decrypted value. `vault_list` returns names + descriptions only.

## Access control

The vault routes are gated behind operator auth (see [operator-auth](operator-auth.md)). `/api/vault*` rejects callers without a valid operator session; the 401 body is generic so secret names are never disclosed to anonymous callers.
