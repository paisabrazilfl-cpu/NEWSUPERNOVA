---
name: Voice control via Vapi
description: Phone-call control plane for BOS-AURA / OPENCLAW OMEGA using Vapi Custom LLM, inline swarm tools, per-call dashboard channels, and authenticated external API access.
---

# Voice Control via Vapi — Phone the Swarm and Run It

BOS-AURA can be controlled entirely from a live phone call through Vapi.

Voice mode lets the operator:

- call ABBY by phone
- speak a goal naturally
- dispatch real orchestrated swarm tasks
- check swarm status
- retrieve the latest result
- persist the full call transcript into the dashboard
- receive end-of-call summaries

Voice mode is implemented inside the OpenAI-compatible external endpoint:

```txt
POST /api/external/v1/chat/completions

This endpoint is used by Vapi as a Custom LLM provider.

When Vapi includes a live call object in the request, BOS-AURA enters voice-call mode.


---

0. Core Design

phone call
  → Vapi transcribes caller speech
  → Vapi sends OpenAI-compatible request to BOS-AURA
  → BOS-AURA detects live call object
  → BOS-AURA creates or reuses one dashboard channel for the call
  → ABBY responds conversationally
  → inline voice tools can dispatch real swarm work
  → transcript and tool actions are logged to the call channel
  → results are spoken back and also persisted in dashboard


---

1. Architecture Rule

Voice mode is self-contained in the custom LLM endpoint.

NO separate Vapi tool-server round trip is required for the main voice loop.

The inline tool path prevents these failures:

missing tool-server secret silencing the assistant

Vapi tool callback drift breaking voice actions

extra network hop delaying live call response

tool execution detached from the call transcript

call actions not appearing in the dashboard



---

2. Endpoint Map

Piece	Endpoint	Purpose

Conversation + actions	POST /api/external/v1/chat/completions	OpenAI-compatible Custom LLM endpoint used by Vapi
Call lifecycle / legacy tools	POST /api/external/v1/vapi/webhook	Optional end-of-call summary and legacy tool callback support



---

3. External API Security

Required environment variable

OPENCLAW_API_KEY=change-me

Hard rule

If OPENCLAW_API_KEY is unset, do NOT connect Vapi.

Without OPENCLAW_API_KEY, the external API is not safe for telephony.


---

4. Authentication Contract

Vapi sends:

Authorization: Bearer <OPENCLAW_API_KEY>

BOS-AURA validates this before allowing:

chat completions

voice tool execution

task dispatch

status checks

last-result reads

webhook lifecycle writes



---

5. Auth Middleware MVP

import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

export function requireExternalApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const expected = process.env.OPENCLAW_API_KEY;

  if (!expected) {
    return res.status(503).json({
      error: {
        message: "External API is not configured.",
        code: "external_api_not_configured",
      },
    });
  }

  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";

  const expectedBuffer = Buffer.from(expected);
  const tokenBuffer = Buffer.from(token);

  if (
    expectedBuffer.length !== tokenBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, tokenBuffer)
  ) {
    return res.status(401).json({
      error: {
        message: "Unauthorized.",
        code: "unauthorized",
      },
    });
  }

  next();
}


---

6. Voice Call Detection

A request is voice-mode when the request body contains a Vapi call object.

export interface VapiCallObject {
  id?: string;
  orgId?: string;
  assistantId?: string;
  phoneNumberId?: string;
  customer?: {
    number?: string;
    name?: string;
  };
  startedAt?: string;
  endedAt?: string;
  status?: string;
}

export function isVoiceCallRequest(body: unknown): boolean {
  const input = body as { call?: VapiCallObject } | null;

  return Boolean(input?.call?.id);
}


---

7. Voice Channel Contract

Each live phone call gets exactly one dashboard channel.

Channel name format:

voice-<MMDD-HHmm>

Example:

voice-0613-2241


---

8. Voice Channel State

export interface VoiceCallSession {
  callId: string;
  channelId: number;
  channelName: string;
  createdAt: Date;
  lastSeenAt: Date;
}


---

9. Voice Channel Naming

export function voiceChannelName(now = new Date()): string {
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");

  return `voice-${mm}${dd}-${hh}${min}`;
}


---

10. Voice Session Resolver

export async function getOrCreateVoiceChannel(input: {
  db: any;
  callId: string;
  createChannel: (payload: { name: string; kind: "voice" }) => Promise<{ id: number; name: string }>;
  findChannelByCallId: (callId: string) => Promise<{ id: number; name: string } | null>;
  bindCallToChannel: (payload: { callId: string; channelId: number }) => Promise<void>;
}): Promise<{ channelId: number; channelName: string }> {
  const existing = await input.findChannelByCallId(input.callId);

  if (existing) {
    return {
      channelId: existing.id,
      channelName: existing.name,
    };
  }

  const channel = await input.createChannel({
    name: voiceChannelName(),
    kind: "voice",
  });

  await input.bindCallToChannel({
    callId: input.callId,
    channelId: channel.id,
  });

  return {
    channelId: channel.id,
    channelName: channel.name,
  };
}


---

11. Transcript Logging Contract

For every live call request, persist:

caller/user message

ABBY response

tool calls

tool outputs

system events

final call summary if available


Message types:

export type VoiceMessageType =
  | "user"
  | "assistant"
  | "system"
  | "tool_call"
  | "tool_output";


---

12. Transcript Logger

export async function logVoiceMessage(input: {
  saveMessage: (payload: {
    channelId: number;
    agentId?: number | null;
    agentName?: string | null;
    messageType: VoiceMessageType;
    content: string;
    metadata?: unknown;
  }) => Promise<void>;
  channelId: number;
  agentId?: number | null;
  agentName?: string | null;
  messageType: VoiceMessageType;
  content: string;
  metadata?: unknown;
}) {
  await input.saveMessage({
    channelId: input.channelId,
    agentId: input.agentId ?? null,
    agentName: input.agentName ?? null,
    messageType: input.messageType,
    content: input.content,
    metadata: input.metadata ?? {},
  });
}


---

13. Voice Tools

Voice mode exposes exactly three built-in inline tools:

dispatch_task
check_status
get_last_result

These tools are offered to the model only when a live call is detected.


---

14. Tool: dispatch_task

Purpose

Dispatches a real goal to ABBY's orchestrator.

Parameters

export interface DispatchTaskArgs {
  task: string;
  priority?: "normal" | "high";
}

Behavior

dispatch_task
  → logs caller task into voice channel
  → creates broadcast command or orchestrator job
  → starts ABBY orchestration fire-and-forget
  → returns voice-sized confirmation

Important

This is the same real multi-CLAW machinery used by the dashboard.


---

15. Tool: check_status

Purpose

Returns a short voice-friendly swarm status summary.

Parameters

export interface CheckStatusArgs {}

Behavior

Reports:

currently running agents

queued commands

running commands

recently completed work

blocked/error state if visible



---

16. Tool: get_last_result

Purpose

Returns ABBY's most recent final briefing.

Parameters

export interface GetLastResultArgs {}

Behavior

Returns:

newest final result from the call channel if present

else newest final briefing globally

markdown stripped for speech



---

17. OpenAI Tool Definitions for Vapi Custom LLM

export const VAPI_INLINE_TOOLS = [
  {
    type: "function",
    function: {
      name: "dispatch_task",
      description:
        "Dispatch a real task to ABBY's multi-agent swarm orchestrator. Use when the caller asks you to do, research, build, compare, post, schedule, investigate, or run something.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          task: {
            type: "string",
            description: "The caller's task or goal to dispatch to the swarm.",
          },
          priority: {
            type: "string",
            enum: ["normal", "high"],
            description: "Task priority. Use high for urgent caller requests.",
          },
        },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_status",
      description:
        "Check current swarm status, including active agents, queued work, running tasks, and recent completions.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_last_result",
      description:
        "Read ABBY's most recent final result or briefing in a short voice-friendly form.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
  },
] as const;


---

18. Voice System Prompt

export const VAPI_VOICE_SYSTEM_PROMPT = `
You are ABBY on a live phone call.

Speak in short, natural sentences.
Prefer one or two sentences unless the caller asks for detail.

When the caller asks you to DO something:
- research
- build
- compare
- post
- schedule
- investigate
- generate
- summarize
- run
- check
- create

call dispatch_task with their request.

Do not pretend to complete long-running work in the conversation.
Dispatch the task and tell the caller it is running.

When the caller asks for progress, call check_status.

When the caller asks for the answer, outcome, result, report, or briefing, call get_last_result.

Do not ask the caller to use the dashboard.
Do not mention internal implementation unless asked.
Do not expose tool JSON.
Do not expose secrets.
`;


---

19. Voice-Sized Speech Normalizer

export function stripMarkdownForSpeech(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, " code block omitted ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[_>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function voiceLimit(input: string, maxChars = 420): string {
  const clean = stripMarkdownForSpeech(input);

  if (clean.length <= maxChars) return clean;

  return clean.slice(0, maxChars - 1).trimEnd() + "…";
}


---

20. Tool Argument Parser

export function parseToolArgs<T>(raw: unknown): T {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return {} as T;
    }
  }

  if (raw && typeof raw === "object") {
    return raw as T;
  }

  return {} as T;
}


---

21. Inline Tool Executor

export async function executeVapiInlineTool(input: {
  name: string;
  arguments: unknown;
  channelId: number;
  callId: string;
  dispatchTask: (payload: {
    task: string;
    priority: "normal" | "high";
    channelId: number;
    callId: string;
  }) => Promise<{ commandId?: number; message: string }>;
  checkStatus: (payload: {
    channelId: number;
    callId: string;
  }) => Promise<string>;
  getLastResult: (payload: {
    channelId: number;
    callId: string;
  }) => Promise<string>;
}): Promise<string> {
  switch (input.name) {
    case "dispatch_task": {
      const args = parseToolArgs<DispatchTaskArgs>(input.arguments);

      const task = String(args.task ?? "").trim();
      const priority = args.priority === "high" ? "high" : "normal";

      if (!task) {
        return "I need a task before I can dispatch the swarm.";
      }

      const result = await input.dispatchTask({
        task,
        priority,
        channelId: input.channelId,
        callId: input.callId,
      });

      return voiceLimit(result.message);
    }

    case "check_status": {
      const result = await input.checkStatus({
        channelId: input.channelId,
        callId: input.callId,
      });

      return voiceLimit(result);
    }

    case "get_last_result": {
      const result = await input.getLastResult({
        channelId: input.channelId,
        callId: input.callId,
      });

      return voiceLimit(result);
    }

    default:
      return `The requested voice tool is not available: ${input.name}.`;
  }
}


---

22. dispatch_task Implementation Contract

export async function dispatchVoiceTask(input: {
  task: string;
  priority: "normal" | "high";
  channelId: number;
  callId: string;
  createCommand: (payload: {
    command: string;
    priority: "normal" | "high";
    channelId: number;
    metadata: unknown;
  }) => Promise<{ id: number }>;
  orchestrateGoal: (payload: {
    commandId: number;
    goal: string;
    channelId: number;
    source: "voice";
    metadata: unknown;
  }) => Promise<void>;
  logVoiceMessage: (payload: {
    channelId: number;
    messageType: VoiceMessageType;
    content: string;
    metadata?: unknown;
  }) => Promise<void>;
}): Promise<{ commandId: number; message: string }> {
  await input.logVoiceMessage({
    channelId: input.channelId,
    messageType: "tool_call",
    content: `dispatch_task: ${input.task}`,
    metadata: {
      callId: input.callId,
      priority: input.priority,
    },
  });

  const command = await input.createCommand({
    command: input.task,
    priority: input.priority,
    channelId: input.channelId,
    metadata: {
      source: "vapi",
      callId: input.callId,
      voice: true,
    },
  });

  void input
    .orchestrateGoal({
      commandId: command.id,
      goal: input.task,
      channelId: input.channelId,
      source: "voice",
      metadata: {
        callId: input.callId,
        priority: input.priority,
      },
    })
    .catch(async (error) => {
      await input.logVoiceMessage({
        channelId: input.channelId,
        messageType: "system",
        content: `Voice dispatch failed: ${String(error)}`,
        metadata: {
          callId: input.callId,
          commandId: command.id,
        },
      });
    });

  const message =
    input.priority === "high"
      ? "I dispatched that as a high priority swarm task. I’ll track the result in this call’s dashboard channel."
      : "I dispatched that to the swarm. I’ll track the result in this call’s dashboard channel.";

  await input.logVoiceMessage({
    channelId: input.channelId,
    messageType: "tool_output",
    content: message,
    metadata: {
      callId: input.callId,
      commandId: command.id,
    },
  });

  return {
    commandId: command.id,
    message,
  };
}


---

23. check_status Implementation Contract

export async function checkVoiceStatus(input: {
  channelId: number;
  callId: string;
  listAgents: () => Promise<Array<{ name: string; status: string }>>;
  listCommands: () => Promise<
    Array<{
      id: number;
      status: "queued" | "running" | "done" | "failed";
      command: string;
      priority?: string;
    }>
  >;
}): Promise<string> {
  const agents = await input.listAgents();
  const commands = await input.listCommands();

  const busyAgents = agents.filter((a) => a.status !== "idle");
  const running = commands.filter((c) => c.status === "running");
  const queued = commands.filter((c) => c.status === "queued");
  const failed = commands.filter((c) => c.status === "failed").slice(0, 2);
  const done = commands.filter((c) => c.status === "done").slice(0, 2);

  const parts: string[] = [];

  if (busyAgents.length) {
    parts.push(
      `${busyAgents.length} agent${busyAgents.length === 1 ? " is" : "s are"} active: ${busyAgents
        .map((a) => `${a.name} is ${a.status}`)
        .join(", ")}.`,
    );
  } else {
    parts.push("All agents look idle right now.");
  }

  if (running.length) {
    parts.push(`${running.length} task${running.length === 1 ? " is" : "s are"} running.`);
  }

  if (queued.length) {
    parts.push(`${queued.length} task${queued.length === 1 ? " is" : "s are"} queued.`);
  }

  if (done.length) {
    parts.push(`Most recent completed task: ${done[0].command}.`);
  }

  if (failed.length) {
    parts.push(`There is a recent failed task: ${failed[0].command}.`);
  }

  return voiceLimit(parts.join(" "));
}


---

24. get_last_result Implementation Contract

export async function getVoiceLastResult(input: {
  channelId: number;
  callId: string;
  getRecentMessages: (payload: {
    channelId: number;
    limit: number;
  }) => Promise<Array<{ messageType: string; content: string | null; agentName?: string | null }>>;
}): Promise<string> {
  const messages = await input.getRecentMessages({
    channelId: input.channelId,
    limit: 100,
  });

  const result =
    messages
      .slice()
      .reverse()
      .find((m) => {
        const content = m.content ?? "";
        return (
          m.messageType === "agent" &&
          /final|result|briefing|complete|done|summary/i.test(content)
        );
      }) ??
    messages
      .slice()
      .reverse()
      .find((m) => m.messageType === "agent" && (m.content ?? "").trim().length > 0);

  if (!result?.content) {
    return "I do not have a completed result in this call yet. You can ask me to check status.";
  }

  return voiceLimit(result.content, 900);
}


---

25. OpenAI-Compatible Request Model

export interface OpenAICompatibleChatRequest {
  model?: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content?: string | null;
    tool_call_id?: string;
    tool_calls?: Array<{
      id: string;
      type: "function";
      function: {
        name: string;
        arguments: string;
      };
    }>;
  }>;
  stream?: boolean;
  tools?: unknown[];
  tool_choice?: unknown;
  call?: VapiCallObject;
}


---

26. OpenAI-Compatible Response Model

export interface OpenAICompatibleChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: "stop" | "tool_calls";
  }>;
}


---

27. Chat Completion Response Helper

export function chatCompletionResponse(input: {
  model: string;
  content: string;
}): OpenAICompatibleChatResponse {
  return {
    id: `chatcmpl_${crypto.randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: input.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: input.content,
        },
        finish_reason: "stop",
      },
    ],
  };
}


---

28. SSE Chunk Helper

export function sseChunk(input: {
  model: string;
  content: string;
}) {
  return `data: ${JSON.stringify({
    id: `chatcmpl_${crypto.randomUUID()}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: input.model,
    choices: [
      {
        index: 0,
        delta: {
          content: input.content,
        },
        finish_reason: null,
      },
    ],
  })}\n\n`;
}

export function sseDone() {
  return "data: [DONE]\n\n";
}


---

29. Custom LLM Route Skeleton

import crypto from "node:crypto";
import { Router } from "express";

export function createExternalRouter(deps: {
  requireExternalApiKey: any;
  getOrCreateVoiceChannel: (callId: string) => Promise<{ channelId: number; channelName: string }>;
  logVoiceMessage: (payload: {
    channelId: number;
    agentId?: number | null;
    agentName?: string | null;
    messageType: VoiceMessageType;
    content: string;
    metadata?: unknown;
  }) => Promise<void>;
  callModel: (payload: OpenAICompatibleChatRequest) => Promise<OpenAICompatibleChatResponse>;
  executeVapiInlineTool: (payload: {
    name: string;
    arguments: unknown;
    channelId: number;
    callId: string;
  }) => Promise<string>;
}) {
  const router = Router();

  router.post("/api/external/v1/chat/completions", deps.requireExternalApiKey, async (req, res) => {
    const body = req.body as OpenAICompatibleChatRequest;
    const model = body.model ?? "abby";
    const voice = isVoiceCallRequest(body);

    if (!voice) {
      const response = await deps.callModel(body);
      return res.json(response);
    }

    const callId = body.call?.id as string;

    const channel = await deps.getOrCreateVoiceChannel(callId);

    const lastUser = body.messages
      .slice()
      .reverse()
      .find((m) => m.role === "user");

    if (lastUser?.content) {
      await deps.logVoiceMessage({
        channelId: channel.channelId,
        messageType: "user",
        content: lastUser.content,
        metadata: {
          callId,
          source: "vapi",
        },
      });
    }

    const modelRequest: OpenAICompatibleChatRequest = {
      ...body,
      model,
      tools: VAPI_INLINE_TOOLS as unknown[],
      messages: [
        {
          role: "system",
          content: VAPI_VOICE_SYSTEM_PROMPT,
        },
        ...body.messages,
      ],
    };

    const first = await deps.callModel(modelRequest);
    const message = first.choices[0]?.message;

    const toolCalls = message?.tool_calls ?? [];

    if (!toolCalls.length) {
      const content = voiceLimit(message?.content ?? "I’m here. What do you want the swarm to do?");

      await deps.logVoiceMessage({
        channelId: channel.channelId,
        agentName: "ABBY",
        messageType: "assistant",
        content,
        metadata: {
          callId,
          model,
        },
      });

      if (body.stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.write(sseChunk({ model, content }));
        res.write(sseDone());
        return res.end();
      }

      return res.json(chatCompletionResponse({ model, content }));
    }

    const spokenParts: string[] = [];

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      const toolArgs = toolCall.function.arguments;

      await deps.logVoiceMessage({
        channelId: channel.channelId,
        messageType: "tool_call",
        content: `${toolName}: ${toolArgs}`,
        metadata: {
          callId,
          toolCallId: toolCall.id,
        },
      });

      const toolResult = await deps.executeVapiInlineTool({
        name: toolName,
        arguments: toolArgs,
        channelId: channel.channelId,
        callId,
      });

      await deps.logVoiceMessage({
        channelId: channel.channelId,
        messageType: "tool_output",
        content: toolResult,
        metadata: {
          callId,
          toolCallId: toolCall.id,
        },
      });

      spokenParts.push(toolResult);
    }

    const content = voiceLimit(spokenParts.join(" "));

    await deps.logVoiceMessage({
      channelId: channel.channelId,
      agentName: "ABBY",
      messageType: "assistant",
      content,
      metadata: {
        callId,
        model,
      },
    });

    if (body.stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.write(sseChunk({ model, content }));
      res.write(sseDone());
      return res.end();
    }

    return res.json(chatCompletionResponse({ model, content }));
  });

  return router;
}


---

30. Vapi Webhook Event Model

export interface VapiWebhookRequest {
  message?: {
    type?: string;
    call?: VapiCallObject;
    transcript?: string;
    summary?: string;
    endedReason?: string;
    durationSeconds?: number;
    toolCallList?: Array<{
      id?: string;
      name?: string;
      arguments?: unknown;
    }>;
  };
  type?: string;
  call?: VapiCallObject;
}


---

31. Webhook Event Type Resolver

export function getVapiMessageType(body: VapiWebhookRequest): string {
  return body.message?.type ?? body.type ?? "unknown";
}

export function getVapiWebhookCall(body: VapiWebhookRequest): VapiCallObject | null {
  return body.message?.call ?? body.call ?? null;
}


---

32. Vapi Webhook Route Skeleton

export function createVapiWebhookRouter(deps: {
  requireExternalApiKey: any;
  getOrCreateVoiceChannel: (callId: string) => Promise<{ channelId: number; channelName: string }>;
  logVoiceMessage: (payload: {
    channelId: number;
    messageType: VoiceMessageType;
    content: string;
    metadata?: unknown;
  }) => Promise<void>;
  executeLegacyTool?: (payload: {
    name: string;
    arguments: unknown;
    callId: string;
    channelId: number;
  }) => Promise<unknown>;
}) {
  const router = Router();

  router.post("/api/external/v1/vapi/webhook", deps.requireExternalApiKey, async (req, res) => {
    const body = req.body as VapiWebhookRequest;
    const type = getVapiMessageType(body);
    const call = getVapiWebhookCall(body);

    if (!call?.id) {
      return res.json({ results: [] });
    }

    const channel = await deps.getOrCreateVoiceChannel(call.id);

    if (type === "end-of-call-report") {
      const summary =
        body.message?.summary ??
        body.message?.transcript ??
        "Call ended. No summary was provided.";

      await deps.logVoiceMessage({
        channelId: channel.channelId,
        messageType: "system",
        content: `📞 Call ended.\n\n${summary}`,
        metadata: {
          callId: call.id,
          type,
          endedReason: body.message?.endedReason,
          durationSeconds: body.message?.durationSeconds,
        },
      });

      return res.json({ results: [] });
    }

    if (type === "tool-calls" && deps.executeLegacyTool) {
      const calls = body.message?.toolCallList ?? [];

      const results = [];

      for (const tool of calls) {
        const result = await deps.executeLegacyTool({
          name: tool.name ?? "",
          arguments: tool.arguments ?? {},
          callId: call.id,
          channelId: channel.channelId,
        });

        results.push({
          toolCallId: tool.id,
          result,
        });
      }

      return res.json({ results });
    }

    return res.json({ results: [] });
  });

  return router;
}


---

33. Vapi Dashboard Configuration

Assistant

Provider: Custom LLM
URL: https://bos-aura.onrender.com/api/external/v1
Model: abby
Credential/API key: OPENCLAW_API_KEY
Authorization mode: Bearer token

Vapi appends:

/chat/completions

Final request target:

https://bos-aura.onrender.com/api/external/v1/chat/completions


---

34. Recommended Vapi Assistant Prompt

You are ABBY on a live phone call.

Answer in one or two short sentences.

When the caller asks you to do work — research, build, compare, investigate, post, schedule, write, generate, or run anything — call dispatch_task with their request.

Do not pretend the long task is complete in the conversation.

Use check_status when asked for progress.

Use get_last_result when asked for the result, outcome, briefing, or answer.

Be clear, direct, and calm.


---

35. Optional Vapi Server URL

For call-end summaries:

https://bos-aura.onrender.com/api/external/v1/vapi/webhook

Server secret:

OPENCLAW_API_KEY

Enable:

end-of-call-report


---

36. Voice Tool Invocation Examples

Caller

Have the swarm research the top three AI voice platforms and compare pricing.

Expected model action:

{
  "name": "dispatch_task",
  "arguments": {
    "task": "Research the top three AI voice platforms and compare pricing.",
    "priority": "normal"
  }
}

Spoken response:

I dispatched that to the swarm. I’ll track the result in this call’s dashboard channel.


---

Caller

What is the status?

Expected model action:

{
  "name": "check_status",
  "arguments": {}
}


---

Caller

Read me the result.

Expected model action:

{
  "name": "get_last_result",
  "arguments": {}
}


---

37. Connected Account Routing Rule

If a caller says:

post this to Instagram
send this email
schedule this
publish this

Then:

dispatch_task routes to the orchestrator.
WIRE handles connected-account/API execution.
The voice assistant does not perform browser password login.


---

38. No Browser Login Rule

Forbidden:

username/password login automation
browser login scripting
cookie theft
session replay
2FA bypass
CAPTCHA bypass

Allowed:

official API connector
OAuth connector
server-side scoped token injection


---

39. Fire-and-Forget Contract

dispatch_task starts work and returns immediately.

Long tasks may finish after the caller hangs up.

Caller can later ask:

What is the status?
Read me the result.


---

40. Dashboard Contract

Every voice call creates or uses one channel.

The channel stores:

caller transcript
ABBY voice replies
tool calls
tool outputs
task dispatch confirmations
swarm results
call-ended summary

This makes phone execution observable from the dashboard.


---

41. Cold Start Note

Render may sleep on free/starter tiers.

If cold:

first Vapi request may be slow
call may have initial silence
subsequent requests are faster

Mitigation:

keep-alive ping
paid always-on plan
external uptime monitor


---

42. Error Handling Rules

Missing API key

Return 503 external_api_not_configured.
Do not process request.

Invalid API key

Return 401 unauthorized.
Do not reveal configured key state beyond generic unauthorized.

Missing call id

Process as normal non-voice chat if chat completion.
Return empty results array if webhook.

Tool failure

Speak a short failure message.
Log exact error to channel.
Do not pretend dispatch succeeded.


---

43. Tool Error Wrapper

export async function safeVoiceTool<T>(input: {
  name: string;
  channelId: number;
  callId: string;
  run: () => Promise<T>;
  logVoiceMessage: (payload: {
    channelId: number;
    messageType: VoiceMessageType;
    content: string;
    metadata?: unknown;
  }) => Promise<void>;
}): Promise<T | string> {
  try {
    return await input.run();
  } catch (error) {
    const message = `Voice tool ${input.name} failed: ${String(error)}`;

    await input.logVoiceMessage({
      channelId: input.channelId,
      messageType: "system",
      content: message,
      metadata: {
        callId: input.callId,
        tool: input.name,
      },
    });

    return "I hit an internal tool error while handling that. The error was logged in the call channel.";
  }
}


---

44. Minimal Test Cases

import { describe, expect, it } from "vitest";

describe("vapi voice helpers", () => {
  it("detects voice calls", () => {
    expect(isVoiceCallRequest({ call: { id: "call_123" } })).toBe(true);
    expect(isVoiceCallRequest({})).toBe(false);
  });

  it("creates voice channel names", () => {
    const d = new Date("2026-06-13T22:41:00Z");
    expect(voiceChannelName(d)).toMatch(/^voice-\d{4}-\d{4}$/);
  });

  it("strips markdown for speech", () => {
    expect(stripMarkdownForSpeech("## Result\n**Done** [`x`](https://x.com)")).toBe(
      "Result Done x",
    );
  });

  it("limits voice output", () => {
    expect(voiceLimit("a".repeat(1000), 100).length).toBeLessThanOrEqual(100);
  });

  it("parses string args", () => {
    expect(parseToolArgs<{ task: string }>('{"task":"run it"}').task).toBe("run it");
  });

  it("handles invalid args", () => {
    expect(parseToolArgs("{bad json")).toEqual({});
  });
});


---

45. OpenAPI / Contract Notes

External endpoint shape:

OpenAI-compatible chat completions.

Streaming:

SSE chunks must end with data: [DONE]

Webhook:

Unknown Vapi server messages must return:
{ "results": [] }

Legacy tool calls:

Return:
{ "results": [{ "toolCallId": "...", "result": ... }] }


---

46. Deployment Environment

Required:

OPENCLAW_API_KEY=...

Recommended:

NODE_ENV=production
RENDER_EXTERNAL_URL=https://bos-aura.onrender.com
KEEP_ALIVE_INTERVAL_MS=600000


---

47. Operational Verification

Health

curl -i https://bos-aura.onrender.com/api/healthz

Unauthorized check

curl -i https://bos-aura.onrender.com/api/external/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"abby","messages":[{"role":"user","content":"hello"}]}'

Expected:

401

Authorized check

curl -i https://bos-aura.onrender.com/api/external/v1/chat/completions \
  -H "Authorization: Bearer $OPENCLAW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"abby","messages":[{"role":"user","content":"hello"}]}'

Expected:

200

Voice mode check

curl -i https://bos-aura.onrender.com/api/external/v1/chat/completions \
  -H "Authorization: Bearer $OPENCLAW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model":"abby",
    "call":{"id":"test-call-001"},
    "messages":[{"role":"user","content":"Have the swarm compare three AI voice platforms."}]
  }'

Expected:

200
dashboard channel created
voice transcript logged
tool dispatch possible


---

48. Acceptance Criteria

1. OPENCLAW_API_KEY protects external endpoints.
2. Vapi Custom LLM requests reach /api/external/v1/chat/completions.
3. Live call object triggers voice mode.
4. One dashboard channel is created per call id.
5. Caller transcript is logged into the call channel.
6. ABBY replies are logged into the call channel.
7. dispatch_task is exposed only in voice mode.
8. check_status is exposed only in voice mode.
9. get_last_result is exposed only in voice mode.
10. dispatch_task creates real orchestrated work.
11. dispatch_task returns a short spoken confirmation.
12. check_status returns short swarm status.
13. get_last_result strips markdown for speech.
14. Tool errors are logged and not converted into success.
15. Webhook unknown events return { results: [] }.
16. End-of-call report writes summary to call channel.
17. Legacy tool-calls can be handled if configured.
18. No browser credential login is required or allowed.
19. Long-running work is fire-and-forget.
20. Results remain available after hangup through dashboard/callback.


---

49. Verification Ledger Template

STATUS: PASS / FAIL / PARTIAL / BLOCKED / NOT VERIFIED

OBSERVED:
- <direct evidence>

CHANGED FILES:
- <path> — <what changed>

COMMANDS RUN:
- <command> → <result>

VERIFICATION:
- auth:      PASS / FAIL / NOT RUN
- voice:     PASS / FAIL / NOT RUN
- tools:     PASS / FAIL / NOT RUN
- webhook:   PASS / FAIL / NOT RUN
- dashboard: PASS / FAIL / NOT RUN
- tests:     PASS / FAIL / NOT RUN

FAILURES:
- <exact error>

UNVERIFIED:
- <anything not proven>

NEXT REQUIRED FIX:
- <smallest next action>


---

50. Final Kernel Rule

A phone call is a real control surface.

If Vapi call id exists:
  create a call channel,
  log the transcript,
  offer inline swarm tools,
  execute tools server-side,
  speak only verified confirmations,
  persist results into the dashboard.

If authentication is missing:
  do nothing.


---

END OF SPEC