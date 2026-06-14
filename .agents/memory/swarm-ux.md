````md id="swarm-activation-ux"

# Swarm activation UX

## execution model reality

The OpenClaw swarm is **event-driven and pull-based**, not continuously active.

Backend orchestration exists independently of UI state:
- `POST /api/commands` → triggers orchestration
- `orchestrateGoal` → decomposes into CLAW directives
- CLAWs execute tool loops asynchronously

---

## perceived "dead swarm" problem

The system appears inactive when:

- no `/api/commands` broadcast is triggered
- CommandBar defaults to `chat` mode instead of `dispatch`
- UI only shows ABBY single-response mode
- `/api/agents` polling shows idle state (correct but misleading)

---

## root cause classification

This is NOT:
- a broken orchestrator
- a failed agent runtime
- missing backend execution

This IS:
- UI-level activation gating issue
- missing dispatch trigger
- incorrect default action mode

---

## critical UX invariant

> The swarm only activates when a global dispatch event is fired.

---

## command routing modes

### 1. chat mode (NON-SWARM)

```ts id="swarm_1"
mode = "chat"
````

* routes to ABBY only
* returns single response
* no orchestration triggered
* no CLAW activation

---

### 2. dispatch mode (SWARM ACTIVE)

```ts id="swarm_2"
mode = "dispatch"
```

Triggers:

* POST /api/commands (broadcast)
* orchestrateGoal execution
* multi-agent activation
* tool execution loops

---

## backend validation rule

Swarm health MUST be validated via API, not UI state:

```bash id="swarm_3"
curl -X POST /api/commands \
  -H "Content-Type: application/json" \
  -d '{"command":"test swarm activation"}'
```

Expected effects:

* new agent_commands row inserted
* agent status transitions to running
* orchestrator loop begins execution

---

## UI failure mode

If CommandBar default = "chat":

* swarm appears idle
* ABBY responds only
* no agent activity visible
* system incorrectly assumed broken

---

## correct default behavior (MVP FIX)

### REQUIRED DEFAULT:

```ts id="swarm_4"
defaultCommandMode = "dispatch"
```

---

## debugging protocol

When swarm appears inactive:

1. verify `/api/commands` POST works
2. check `agent_commands.status` transitions
3. confirm `/api/agents` updates
4. only then inspect frontend state

---

## system invariant

> UI is a trigger surface, not the source of truth for execution state.

---

## final rule

If backend executes but UI shows inactivity:
→ UI is wrong
→ NOT the swarm

---

END OF SPEC

```
```
