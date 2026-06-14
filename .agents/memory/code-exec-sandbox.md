````md
# code_exec sandboxing

## goal
The `code_exec` tool executes untrusted model-generated code. The system assumes **all code is hostile by default** and must be isolated at the OS kernel level.

---

## why language-level guards are rejected

Language-based restrictions (Python preambles, JS overrides, import blocking, etc.) are explicitly insufficient because they are:

- bypassable via native FFI (`ctypes`, `ffi`, `process.binding`, etc.)
- bypassable via dynamic imports (`importlib`, `require`, eval chains)
- non-deterministic across runtimes
- impossible to enforce at syscall boundary

➡️ Therefore: **security must be kernel-enforced, not interpreter-enforced**

---

## isolation model (hard requirement)

All `code_exec` runs MUST be executed inside:

```bash
unshare --net --mount --map-root-user
````

### enforced isolation layers

#### 1. network isolation

* `--net` disables all outbound/inbound network access
* prevents:

  * SSRF bypass via code_exec
  * exfiltration via sockets
  * covert channel communication

---

#### 2. filesystem isolation

Inside namespace:

```bash
mount -t tmpfs tmpfs /home
```

effects:

* `/home` becomes empty ephemeral RAM filesystem
* host workspace becomes invisible
* repository cannot be read, scanned, or modified

---

#### 3. privilege isolation

* `--map-root-user` provides fake root inside namespace
* does NOT grant host root privileges
* prevents privilege escalation impact outside namespace

---

## runtime execution model

### execution flow

1. write code to temp file
2. spawn isolated namespace
3. mount tmpfs `/home`
4. execute file inside sandbox
5. capture stdout/stderr
6. kill process group on timeout

---

### critical safety constraint

```text
CODE IS NEVER EXECUTED INLINE (-c / -e FORBIDDEN)
```

Reason:

* prevents shell quoting escape
* prevents injection into execution string context

---

## process control model

* execution runs in a **detached process group**
* timeout enforcement uses:

```bash
kill -<pgid>
```

NOT PID-only termination

Reason:

* ensures child processes cannot escape sandbox lifecycle

---

## failure handling (HARD FAIL CLOSED)

### if ANY of the following fail:

* unshare unavailable
* mount tmpfs fails
* namespace creation fails

➡️ system MUST:

```text
EXIT CODE 97
DO NOT EXECUTE USER CODE
LOG: ISOLATION FAILURE
```

---

## sandbox capability probe

Before first execution:

```ts
detectSandboxMode()
```

must verify:

* `unshare --map-root-user` succeeds
* `mount -t tmpfs tmpfs /home` succeeds inside namespace

### IMPORTANT

Checking only `unshare` is INVALID.

Both conditions MUST pass or system is considered:

```text
NON-ISOLATED
```

---

## fallback mode (restricted only)

If isolation fails:

* code_exec runs in scrubbed environment
* environment variables stripped
* NO network access assumed (but NOT guaranteed)
* filesystem still visible (WARN STATE)

Logged as:

```text
WARNING: NO KERNEL ISOLATION AVAILABLE
```

---

## known unresolved risk

### DNS rebinding / TOCTOU issue

* SSRF guard resolves DNS at check-time
* fetch resolves DNS again at runtime

➡️ creates potential bypass window

**STATUS:** acknowledged, not yet fixed

---

## security invariant

```text
If code_exec can see the repo, the system is compromised.
```

---

## design principle

> All safety must be enforced at the kernel boundary.
> Anything above syscall level is considered advisory only.

```
```
