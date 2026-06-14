````md id="secrets-vault"

# secrets-vault

## security model

The OPENCLAW vault is a **sealed secret-injection system** designed to ensure that credentials never pass through:

- chat history
- LLM context window
- database message logs
- tool telemetry payloads
- API request bodies (persisted)

---

## core invariant

> Secrets must only exist in memory at the moment of outbound execution, never in persistent state.

---

## secret representation model

### stored form (persistent)
```ts id="vault_1"
{{secret:NAME}}
````

* this is the ONLY value stored in:

  * DB
  * tool_calls.args
  * orchestrator logs
  * message history

---

### resolved form (ephemeral only)

```ts id="vault_2"
REAL_SECRET_VALUE
```

* exists ONLY in runtime memory
* injected immediately before outbound request
* must NEVER be persisted or logged

---

## secret injection pipeline

### 1. substitution phase

```ts id="vault_3"
function substituteSecrets(input: any, vault: Record<string, string>) {
  const used = new Set<string>();

  const resolved = JSON.parse(JSON.stringify(input), (_, value) => {
    if (typeof value !== "string") return value;

    const match = value.match(/\{\{secret:([A-Z0-9_]+)\}\}/);

    if (!match) return value;

    const key = match[1];
    used.add(key);

    return vault[key];
  });

  return { resolved, used };
}
```

---

## 2. redaction phase (CRITICAL)

Any response from external systems MUST be sanitized:

```ts id="vault_4"
function redactSecrets(output: any, used: Set<string>, vault: Record<string, string>) {
  let text = JSON.stringify(output);

  for (const key of used) {
    const value = vault[key];
    if (!value) continue;

    text = text.replaceAll(value, "[REDACTED_SECRET]");
  }

  return JSON.parse(text);
}
```

---

## 3. reflection attack protection

Any of the following MUST be assumed hostile:

* echo APIs
* debug endpoints
* verbose auth errors
* upstream API error dumps

### rule:

> If it can reflect input, it can leak secrets.

---

## enforcement requirement

Every tool consuming secrets MUST implement BOTH:

* `substituteSecrets()` BEFORE execution
* `redactSecrets()` AFTER execution

---

## fail-closed security rule

```ts id="vault_5"
if (!process.env.SESSION_SECRET) {
  throw new Error("VAULT_UNAVAILABLE: missing encryption key");
}
```

---

## write isolation rule

The following are STRICTLY forbidden:

* storing resolved secrets in DB
* persisting outbound request bodies after substitution
* logging full HTTP request payloads
* returning raw tool results without redaction

---

## operator access control

Vault APIs are protected by:

* operator-auth middleware
* session-bound HMAC token validation

Unauthorized access MUST return:

```json id="vault_6"
{ "authenticated": false }
```

(no metadata, no schema leakage, no secret names)

---

## system invariant

> A secret that appears in persistent storage is a system failure.

---

## security principle

* chat is untrusted
* model context is untrusted
* tools are untrusted
* only runtime injection layer is trusted

---

END OF SPEC

```
```
