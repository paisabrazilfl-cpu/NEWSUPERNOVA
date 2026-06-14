-````md id="tool-call-status-enum"

# tool_calls.status enum

## canonical type definition

The `tool_calls.status` field is strictly defined by the OpenAPI schema as:

```ts id="tool_status_1"
type ToolCallStatus =
  | "pending"
  | "running"
  | "success"
  | "error";
````

---

## persistence rule (STRICT)

All server-side tool execution code MUST conform to:

| runtime outcome                  | stored value |
| -------------------------------- | ------------ |
| execution starts                 | `running`    |
| execution queued                 | `pending`    |
| execution completes successfully | `success`    |
| execution fails                  | `error`      |

---

## forbidden values (HARD FAILURE)

The following MUST NEVER be written to `tool_calls.status`:

* `done`
* `failed`
* `completed`
* `ok`
* `succeeded`

Reason:

> These values are NOT part of the OpenAPI contract and will break generated clients.

---

## frontend contract dependency

Frontend systems (AgentInspector, execution matrix UI) assume:

* green = `success`
* red = `error`
* yellow = `running`
* gray = `pending`

Any deviation results in:

* missing UI indicators
* broken status rendering
* silent failure in execution visualization

---

## mapping rule (SERVER SIDE ONLY)

```ts id="tool_status_2"
function mapToolResult(ok: boolean): ToolCallStatus {
  return ok ? "success" : "error";
}
```

---

## orchestration enforcement rule

Inside any tool runner / orchestrator:

```ts id="tool_status_3"
tool_call.status = "running"; // on start

try {
  await executeTool();
  tool_call.status = "success";
} catch {
  tool_call.status = "error";
}
```

---

## migration constraint

If a new status is required:

1. update OpenAPI spec first
2. regenerate client:

```bash id="tool_status_4"
pnpm --filter @workspace/api-spec run codegen
```

3. THEN update backend + frontend

---

## system invariant

> tool_calls.status is a closed set enforced by schema, not runtime convention.

---

END OF SPEC

```
```
