````md id="claw-agent-tool-security"

# agent tool security
Security posture for the autonomous CLAW agent tools (http_request, code_exec, and write-capable primitives).

---

# autonomous agent tool security model

CLAW agents operate as **untrusted autonomous executors**.  
All tool usage is assumed adversarial until validated by runtime guards.

---

# 1. http_request — SSRF-GATED OUTBOUND NETWORK TOOL

## risk class
CRITICAL — network boundary escape vector

---

## mandatory enforcement rules

### 1.1 SSRF guard (hard requirement)
All outbound requests MUST pass `ssrfGuard(url)` before execution:

- block localhost:
  - 127.0.0.1 / 0.0.0.0 / ::1
- block link-local:
  - 169.254.169.254 (cloud metadata)
- block private ranges:
  - 10.0.0.0/8
  - 172.16.0.0/12
  - 192.168.0.0/16
- block internal domains:
  - *.local
  - *.internal
  - localhost domains

---

### 1.2 redirect security (CRITICAL HARDENING)

All HTTP requests MUST enforce:

```ts
redirect: "manual"
````

AND re-run SSRF validation on EVERY hop:

* validate initial URL
* intercept Location header
* re-run ssrfGuard on redirected URL
* repeat until terminal response

---

### 1.3 forbidden behaviors

* NO automatic redirect following
* NO DNS resolution bypass
* NO URL normalization trust
* NO protocol switching trust (http → https redirect must revalidate)

---

### 1.4 threat model assumption

All external URLs are potentially:

* SSRF pivot points
* metadata extraction endpoints
* internal service probes

---

# 2. code_exec — SANDBOXED EXECUTION KERNEL

## risk class

CRITICAL — full system execution vector

---

## isolation contract

code_exec MUST run inside:

* unshare namespace isolation

  * network namespace blocked
  * mount namespace isolated
* tmpfs filesystem overlay
* no host filesystem visibility

---

## mandatory constraints

### 2.1 fail-closed execution

If sandbox setup fails:
→ EXECUTION MUST STOP

---

### 2.2 no repo access

Explicitly forbidden inside sandbox:

* repository mount
* working directory injection
* shell escape to host filesystem

---

### 2.3 tool boundary rule

Agents MUST NOT be granted:

* shell access
* raw filesystem tools
* persistent disk writes
* network access inside sandbox

---

### 2.4 execution principle

> code_exec is compute-only, not environment-aware

---

# 3. calculator — STRICT EVAL ENGINE

## risk class

LOW → MEDIUM (depends on misuse vector)

---

## enforcement rules

### 3.1 whitelist-only evaluation

Allowed characters ONLY:

```
[-+*/%.()0-9eE\s]
```

---

### 3.2 forbidden tokens

* letters (a-z, A-Z)
* identifiers
* variables
* function calls
* global object access

---

### 3.3 evaluation engine constraint

Must use:

```ts
new Function("return " + expression)
```

ONLY AFTER whitelist validation.

---

### 3.4 safety invariant

> calculator must never become a code execution escape vector

---

# 4. send_message — CONTEXT-BOUND OUTPUT TOOL

## risk class

HIGH — data exfiltration / routing abuse vector

---

## enforcement rules

### 4.1 target binding rule

Channel target MUST be:

```ts
ctx.channelId
```

NOT:

* model-provided input
* user-controlled parameters
* tool arguments

---

### 4.2 forbidden behavior

* NO arbitrary channel injection
* NO cross-session message routing
* NO spoofed sender identity

---

### 4.3 principle

> message routing is a system-level privilege, never an agent-level decision

---

# 5. EXTENSIBILITY RULE (CRITICAL ARCHITECTURE CONTROL)

Any new tool MUST declare:

## 5.1 tool class

* network tool → MUST use ssrfGuard
* execution tool → MUST use sandbox isolation
* eval tool → MUST use whitelist restriction
* write tool → MUST use context-bound target

---

## 5.2 mandatory review gate

New tools cannot be deployed unless they pass:

* SSRF safety review (if URL-based)
* sandbox isolation verification (if exec-based)
* privilege boundary audit (if write-based)

---

# 6. GLOBAL SECURITY INVARIANT

## core rule

> All agent tools are hostile by default until proven safe by deterministic runtime checks.

---

## enforcement summary

| Tool         | Primary Risk          | Guard                             |
| ------------ | --------------------- | --------------------------------- |
| http_request | SSRF / internal pivot | ssrfGuard + redirect revalidation |
| code_exec    | system takeover       | namespace sandbox + fail-closed   |
| calculator   | eval injection        | strict whitelist                  |
| send_message | routing abuse         | ctx-bound channel enforcement     |

---

# 7. ARCHITECTURAL TRUTH

* Agents are NOT trusted
* Tools are NOT trusted
* Inputs are ALWAYS adversarial
* Only runtime guards define safety

---

END OF SPEC

```
```
