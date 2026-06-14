# name
ABBYCLAW Repo

# description
ABBYCLAW is a private GitHub fork of OpenClaw. It is a hardened multi-agent execution runtime that extends OpenClaw into a full tool-armed agent operating system with role-specialized CLAW agents and unified capability inheritance.

---

# what ABBYCLAW is

`paisabrazilfl-cpu/ABBYCLAW` is a private fork of the OpenClaw agent runtime.

It is not a wrapper or assistant layer — it is a **full agent execution platform (agent OS)** designed for deterministic tool execution, policy-gated autonomy, and multi-agent orchestration.

The system defines:
- a shared runtime kernel
- a unified tool registry
- role-specialized agents (CLAWs)
- cross-agent session coordination
- persistent memory + automation loops

---

# core system architecture

ABBYCLAW operates as a **single unified runtime with multi-agent specialization layers**.

All agents inherit:
- full tool access
- shared execution kernel
- shared policy enforcement layer
- shared memory + session system

---

# tool inventory (global capability set)

## 1. Runtime Layer
- exec
- code_execution
- process

---

## 2. File System Layer
- read
- write
- edit
- apply_patch
- diffs

---

## 3. Web Layer
- web_search
- x_search
- web_fetch

---

## 4. Browser Layer
- browser
- screenshot
- pdf

---

## 5. Memory Layer
- memory_lancedb
- memory_wiki

---

## 6. Agent Orchestration Layer
- subagents
- sessions_spawn
- sessions_history
- agents_list
- goal
- session_status

---

## 7. Automation Layer
- cron
- heartbeat_respond
- webhook
- message

---

## 8. Media + AI Generation Layer
- image
- image_generate
- tts
- music_generate
- video_generate
- llm_task
- tokenjuice
- lobster

---

## 9. Gateway / Network Layer
- gateway
- nodes
- tool_search
- tool_describe

---

# agent role specializations

All agents have **full tool access**, but differ in execution priority and default tool routing behavior.

---

## FORGE — Code Execution Agent
Primary focus:
- exec
- code_execution
- apply_patch

Role:
- software generation
- patching systems
- runtime execution
- build orchestration

---

## CRAWLER — Web Intelligence Agent
Primary focus:
- browser
- web_fetch
- web_search
- x_search

Role:
- data extraction
- research pipelines
- page synthesis
- external signal ingestion

---

## VAULT — Memory & Knowledge Agent
Primary focus:
- memory_lancedb
- memory_wiki
- tool_search

Role:
- persistent memory management
- retrieval augmentation
- knowledge structuring
- semantic indexing

---

## WIRE — Integration & Automation Agent
Primary focus:
- message
- cron
- heartbeat_respond
- gateway

Role:
- API orchestration
- scheduling systems
- external integrations
- event-driven automation

---

# system design principle

## unified rule
All CLAWs are equal-capability agents.

Differentiation is **behavioral routing, not permission restriction**.

---

## execution philosophy

- no agent is sandboxed from tools
- all safety is enforced at runtime policy layer
- all execution is traceable via session logs
- all actions must pass kernel policy gates before execution

---

# purpose

ABBYCLAW exists to:

- unify multi-agent execution under one runtime
- eliminate tool fragmentation across agents
- enforce deterministic execution safety
- enable scalable autonomous workflows across specialized agents
- provide a production-grade agent operating system layer on top of OpenClaw
