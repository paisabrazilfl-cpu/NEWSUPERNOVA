---
name: code_exec sandboxing
description: How code_exec is isolated and why language-level guards alone were rejected
---

# code_exec isolation

The `code_exec` agent tool runs untrusted, model-authored code. Setting `cwd` + scrubbing env vars is **not** isolation: a subprocess still runs as the same OS user with full filesystem access and open network, so it can read/write the repo and bypass the `http_request` SSRF guard.

**Decision:** wrap execution in `unshare --net --mount --map-root-user` and `mount -t tmpfs tmpfs /home` inside the namespace.
- `--net` → no network (closes SSRF-bypass / exfiltration via code_exec).
- `--mount` + tmpfs over `/home` → the app/repo (`/home/runner/workspace`) is invisible and unwritable to executed code.
- Runtimes live in `/nix` + `/usr`, so they still resolve; PATH is inherited.

**Why not bwrap/firejail/nsjail:** none are installed in this environment; only `unshare`/`prlimit`/`setpriv` are. Unprivileged user namespaces ARE enabled here (`unshare --map-root-user` works).

**Why not language-level guards (blocking `socket`/`open` in a Python preamble):** trivially defeatable via `ctypes`/`importlib`/`require`, and gives false confidence. Namespace isolation is enforced by the kernel.

**How to apply / caveats:**
- Capability is probed once at runtime (`detectSandboxMode`) and cached. The probe must verify BOTH `unshare` AND that `mount -t tmpfs tmpfs /home` succeeds inside the throwaway namespace — checking `unshare` exit alone would report "namespace" mode while the repo stays visible. If either fails it **falls back to a scrubbed-env subprocess with NO net/fs isolation** and logs a warning — isolation is host-dependent (Render parity not guaranteed; check the startup log line).
- The runtime wrapper is **fail-closed**: if the `/home` tmpfs mask can't be applied it aborts with exit 97 WITHOUT running the code, so code never executes with the repo visible.
- Source is written to a temp file and executed as a FILE (never inline `-c`/`-e`) so user code can't break out of the shell-`-c` wrapper quoting.
- Spawn is `detached` and killed via process-group (`process.kill(-pid)`) on timeout/output-cap, because killing only the `unshare` parent would orphan the runtime child.
- Remaining gap (not fixed): `http_request` SSRF guard resolves DNS then `fetch` resolves again → DNS-rebinding TOCTOU.
