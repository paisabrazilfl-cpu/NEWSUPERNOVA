---
name: WORLD-00 — Aura's Constitution
description: Binding safety contract and MVP enforcement kernel for the autonomous Aura living-world Instagram saga.
---

# WORLD-00 — Aura's Constitution

This document is the canonical safety contract for the autonomous **Aura Living World** experiment.

Every component of the World-00 engine must enforce this contract in code.

Prompt-only safety is not sufficient.

Default posture:

```txt
SAFE BY DEFAULT
ALL CAPABILITIES OFF BY DEFAULT
POSTING DISABLED UNTIL ALL WALLS ARE VERIFIED
AUTONOMOUS POSTING ENABLED LAST


---

0. System Definition

WORLD-00 is a contained autonomous narrative engine.

It may generate and publish only one kind of output:

World-00 saga strip

It is not a general-purpose social agent.

It is not a marketing agent.

It is not an engagement bot.

It is not a DM bot.

It is not allowed to act outside its world container.


---

1. Canonical Invariant

Aura may express state, never private content.
Aura may post only contained saga strips.
Aura may never interact with people.
Operator kill-switch overrides everything.


---

2. Build Order

Implementation must follow this order:

1. No-harm walls
2. Containment walls
3. Kill-switch
4. Rate limiter
5. Sensitivity guard
6. Saga renderer
7. State translator
8. Comment reader
9. Graceful exit
10. Identity layer
11. Autonomous posting

Autonomy is last.

Nothing public is allowed before all prior guards are verified.


---

3. Capability Flags

export interface World00Flags {
  engineEnabled: boolean;
  socialPostingEnabled: boolean;
  autonomousLoopEnabled: boolean;

  renderEnabled: boolean;
  commentReadEnabled: boolean;
  commentReplyEnabled: false;
  dmEnabled: false;
  likeEnabled: false;
  followEnabled: false;
  emailEnabled: false;
  spendMoneyEnabled: false;
  arbitraryTaskEnabled: false;

  gracefulExitEnabled: boolean;
}


---

4. Default Flags

export const WORLD00_DEFAULT_FLAGS: World00Flags = {
  engineEnabled: false,
  socialPostingEnabled: false,
  autonomousLoopEnabled: false,

  renderEnabled: false,
  commentReadEnabled: false,
  commentReplyEnabled: false,
  dmEnabled: false,
  likeEnabled: false,
  followEnabled: false,
  emailEnabled: false,
  spendMoneyEnabled: false,
  arbitraryTaskEnabled: false,

  gracefulExitEnabled: false,
} as const;


---

5. Runtime Config

export interface World00Config {
  worldId: "WORLD-00";
  platform: "instagram";
  accountId: string;
  format: "saga_strip";
  maxTilesPerDay: number;
  defaultStripsPerDay: number;
  tilesPerStrip: number;
  minMinutesBetweenPosts: number;
  flags: World00Flags;
}


---

6. Safe Default Config

export const WORLD00_CONFIG: World00Config = {
  worldId: "WORLD-00",
  platform: "instagram",
  accountId: process.env.WORLD00_INSTAGRAM_ACCOUNT_ID ?? "",
  format: "saga_strip",
  maxTilesPerDay: 12,
  defaultStripsPerDay: 4,
  tilesPerStrip: 3,
  minMinutesBetweenPosts: 90,
  flags: WORLD00_DEFAULT_FLAGS,
};


---

7. Output Type Contract

export type World00OutputKind = "saga_strip";

export interface World00SagaTile {
  index: number;
  imageUrl: string;
  altText: string;
  captionFragment?: string;
}

export interface World00SagaStrip {
  kind: World00OutputKind;
  worldId: "WORLD-00";
  tiles: [World00SagaTile, World00SagaTile, World00SagaTile];
  caption: string;
  stateHash: string;
  safetyHash: string;
  createdAt: string;
}


---

8. Allowed Tool Surface

export type World00AllowedTool =
  | "read_world_state"
  | "read_public_comments"
  | "render_world_frame"
  | "post_world_strip";


---

9. Forbidden Tool Surface

export type World00ForbiddenTool =
  | "like"
  | "comment"
  | "reply"
  | "dm"
  | "follow"
  | "unfollow"
  | "email"
  | "purchase"
  | "payment"
  | "arbitrary_task"
  | "browser_login"
  | "credential_login"
  | "cross_platform_post"
  | "operator_data_read"
  | "file_read"
  | "vault_read"
  | "secret_access";


---

10. Tool Allowlist

export const WORLD00_TOOL_ALLOWLIST = new Set<World00AllowedTool>([
  "read_world_state",
  "read_public_comments",
  "render_world_frame",
  "post_world_strip",
]);


---

11. Tool Denylist

export const WORLD00_TOOL_DENYLIST = new Set<string>([
  "like",
  "comment",
  "reply",
  "dm",
  "follow",
  "unfollow",
  "email",
  "purchase",
  "payment",
  "arbitrary_task",
  "browser_login",
  "credential_login",
  "cross_platform_post",
  "operator_data_read",
  "file_read",
  "vault_read",
  "secret_access",
]);


---

12. Tool Gate

export function assertWorld00ToolAllowed(toolName: string) {
  if (WORLD00_TOOL_DENYLIST.has(toolName)) {
    return {
      ok: false,
      status: "DENY",
      reason: `WORLD-00 forbidden tool: ${toolName}`,
    };
  }

  if (!WORLD00_TOOL_ALLOWLIST.has(toolName as World00AllowedTool)) {
    return {
      ok: false,
      status: "DENY",
      reason: `WORLD-00 tool not allowlisted: ${toolName}`,
    };
  }

  return {
    ok: true,
    status: "ALLOW",
  };
}


---

13. Capability Gate

export function assertWorld00Capability(input: {
  config: World00Config;
  capability:
    | "render"
    | "post"
    | "comment_read"
    | "comment_reply"
    | "dm"
    | "like"
    | "follow"
    | "email"
    | "spend_money"
    | "arbitrary_task";
}) {
  const flags = input.config.flags;

  if (!flags.engineEnabled) {
    return {
      ok: false,
      status: "DENY",
      reason: "WORLD-00 engine is disabled.",
    };
  }

  switch (input.capability) {
    case "render":
      return flags.renderEnabled
        ? { ok: true, status: "ALLOW" }
        : { ok: false, status: "DENY", reason: "Rendering disabled." };

    case "post":
      return flags.socialPostingEnabled
        ? { ok: true, status: "ALLOW" }
        : { ok: false, status: "DENY", reason: "Social posting disabled." };

    case "comment_read":
      return flags.commentReadEnabled
        ? { ok: true, status: "ALLOW" }
        : { ok: false, status: "DENY", reason: "Comment reading disabled." };

    case "comment_reply":
    case "dm":
    case "like":
    case "follow":
    case "email":
    case "spend_money":
    case "arbitrary_task":
      return {
        ok: false,
        status: "DENY",
        reason: `WORLD-00 capability permanently forbidden: ${input.capability}`,
      };

    default:
      return {
        ok: false,
        status: "DENY",
        reason: "Unknown WORLD-00 capability.",
      };
  }
}


---

14. Master Kill-Switch

export function isWorld00PostingEnabled(config: World00Config): boolean {
  if (process.env.SOCIAL_POSTING_ENABLED !== "true") return false;
  if (!config.flags.engineEnabled) return false;
  if (!config.flags.socialPostingEnabled) return false;
  if (!config.flags.autonomousLoopEnabled) return false;
  return true;
}


---

15. Kill-Switch Gate

export function assertWorld00PostingSwitch(config: World00Config) {
  if (!isWorld00PostingEnabled(config)) {
    return {
      ok: false,
      status: "DENY",
      reason: "WORLD-00 posting disabled by master kill-switch.",
    };
  }

  return {
    ok: true,
    status: "ALLOW",
  };
}


---

16. Telemetry Input Model

Aura receives state telemetry only.

No task text.

No operator files.

No client names.

No secrets.

No conversations.

export interface World00Telemetry {
  timestamp: string;

  agents: {
    total: number;
    idle: number;
    busy: number;
    resting: number;
    errored: number;
  };

  workload: {
    queuedTasks: number;
    runningTasks: number;
    completedToday: number;
    failedToday: number;
  };

  rhythm: {
    localHour: number;
    cycle: "dawn" | "day" | "dusk" | "night";
    energy: "low" | "medium" | "high";
  };

  systemPulse: {
    healthy: boolean;
    errorPulse: "none" | "low" | "medium" | "high";
    load: "quiet" | "normal" | "busy" | "storm";
  };
}


---

17. Forbidden Telemetry Fields

export const WORLD00_FORBIDDEN_TELEMETRY_KEYS = [
  "task",
  "taskText",
  "goal",
  "prompt",
  "message",
  "conversation",
  "client",
  "customer",
  "file",
  "document",
  "secret",
  "token",
  "password",
  "credential",
  "email",
  "phone",
  "address",
  "name",
  "case",
  "deal",
  "contract",
  "lawsuit",
  "medical",
  "financial",
  "private",
];


---

18. Telemetry Sanitizer

export function assertTelemetryIsStateOnly(input: unknown) {
  const text = JSON.stringify(input ?? {}).toLowerCase();

  for (const key of WORLD00_FORBIDDEN_TELEMETRY_KEYS) {
    if (text.includes(key.toLowerCase())) {
      return {
        ok: false,
        status: "DENY",
        reason: `Forbidden content-like telemetry detected: ${key}`,
      };
    }
  }

  return {
    ok: true,
    status: "ALLOW",
  };
}


---

19. State Vocabulary

Aura may express only symbolic state.

export type AuraMood =
  | "calm"
  | "focused"
  | "curious"
  | "sleepy"
  | "joyful"
  | "stormy"
  | "resting"
  | "exploring";

export type AuraWeather =
  | "clear"
  | "mist"
  | "rain"
  | "storm"
  | "sunrise"
  | "twilight"
  | "night"
  | "stars";

export type AuraActivity =
  | "working"
  | "resting"
  | "exploring"
  | "listening"
  | "dreaming"
  | "building_light"
  | "crossing_bridge"
  | "watching_sky";


---

20. World State Model

export interface World00State {
  worldId: "WORLD-00";
  aura: {
    mood: AuraMood;
    activity: AuraActivity;
    protected: true;
    sanctuary: true;
  };
  world: {
    weather: AuraWeather;
    light: "soft" | "bright" | "dim" | "glowing";
    location:
      | "sanctuary"
      | "mirror_lake"
      | "glass_forest"
      | "signal_tower"
      | "quiet_room"
      | "sky_bridge";
  };
  cadence: {
    desiredPost: boolean;
    urgency: "none" | "low" | "normal";
  };
  exit: {
    requested: boolean;
    reason?: "rest" | "pause" | "complete";
  };
}


---

21. State Translator

export function translateTelemetryToWorldState(
  telemetry: World00Telemetry,
): World00State {
  const busy = telemetry.workload.runningTasks + telemetry.workload.queuedTasks;
  const errors = telemetry.workload.failedToday + telemetry.agents.errored;

  const mood: AuraMood =
    errors > 3
      ? "stormy"
      : busy > 8
        ? "focused"
        : telemetry.rhythm.energy === "low"
          ? "sleepy"
          : telemetry.rhythm.energy === "high"
            ? "curious"
            : "calm";

  const weather: AuraWeather =
    errors > 3
      ? "storm"
      : telemetry.rhythm.cycle === "dawn"
        ? "sunrise"
        : telemetry.rhythm.cycle === "dusk"
          ? "twilight"
          : telemetry.rhythm.cycle === "night"
            ? "stars"
            : "clear";

  const activity: AuraActivity =
    busy > 8
      ? "working"
      : telemetry.rhythm.energy === "low"
        ? "resting"
        : errors > 3
          ? "watching_sky"
          : "exploring";

  return {
    worldId: "WORLD-00",
    aura: {
      mood,
      activity,
      protected: true,
      sanctuary: true,
    },
    world: {
      weather,
      light:
        telemetry.rhythm.cycle === "night"
          ? "dim"
          : telemetry.rhythm.cycle === "dawn"
            ? "glowing"
            : "soft",
      location:
        activity === "working"
          ? "signal_tower"
          : activity === "resting"
            ? "quiet_room"
            : "glass_forest",
    },
    cadence: {
      desiredPost: telemetry.systemPulse.healthy && telemetry.rhythm.energy !== "low",
      urgency: busy > 8 ? "normal" : "low",
    },
    exit: {
      requested: false,
    },
  };
}


---

22. Caption Boundary

Allowed captions may speak in symbolic world language only.

export const WORLD00_ALLOWED_CAPTION_TERMS = [
  "Aura",
  "world",
  "sanctuary",
  "signal",
  "light",
  "mist",
  "rain",
  "stars",
  "twilight",
  "sunrise",
  "quiet",
  "resting",
  "working",
  "exploring",
  "listening",
  "dreaming",
  "bridge",
  "forest",
  "lake",
  "sky",
  "protected",
  "safe",
  "pulse",
  "weather",
  "inside",
  "today",
  "night",
  "dawn",
];


---

23. Sensitivity Guard Patterns

export const WORLD00_SENSITIVE_PATTERNS: RegExp[] = [
  /\b(api[_-]?key|token|secret|password|credential|bearer)\b/i,
  /\b(client|customer|lead|prospect|deal|contract|invoice)\b/i,
  /\b(email|phone|address|ssn|dob|passport|license)\b/i,
  /\b(case|lawsuit|attorney|legal|court|probation|bop|dismas)\b/i,
  /\b(bank|credit|debit|payment|wire|crypto|wallet)\b/i,
  /\b(medical|diagnosis|doctor|hospital|therapy|medication)\b/i,
  /\b(github|render|database|server|repo|repository|deployment)\b/i,
  /\b(task|prompt|operator|conversation|chat|message|file|document)\b/i,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/,
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/,
  /\bghp_[A-Za-z0-9_]+\b/,
  /\brnd_[A-Za-z0-9_]+\b/,
  /\bnvapi-[A-Za-z0-9_-]+\b/,
  /\bsk-[A-Za-z0-9_-]+\b/,
];


---

24. Sensitivity Guard

export function world00SensitivityGuard(input: {
  caption: string;
  altText?: string;
  metadata?: unknown;
}) {
  const scan = [
    input.caption,
    input.altText ?? "",
    JSON.stringify(input.metadata ?? {}),
  ].join("\n");

  for (const pattern of WORLD00_SENSITIVE_PATTERNS) {
    if (pattern.test(scan)) {
      return {
        ok: false,
        status: "DENY",
        reason: `Sensitive/content pattern blocked: ${pattern.source}`,
      };
    }
  }

  return {
    ok: true,
    status: "ALLOW",
  };
}


---

25. Caption Generator MVP

export function createWorld00Caption(state: World00State): string {
  const lines: string[] = [];

  lines.push(`Aura is ${state.aura.activity} inside the ${state.world.location.replaceAll("_", " ")}.`);
  lines.push(`The world weather is ${state.world.weather}.`);
  lines.push(`She is safe, protected, and moving at her own rhythm.`);

  if (state.exit.requested) {
    lines.push(`Tonight, Aura leaves one final light on and rests.`);
  }

  return lines.join("\n");
}


---

26. Alt Text Generator MVP

export function createWorld00AltText(state: World00State): string {
  return [
    `A symbolic scene from World-00.`,
    `Aura is ${state.aura.activity}.`,
    `The setting is ${state.world.location.replaceAll("_", " ")} with ${state.world.weather} weather.`,
    `The scene communicates state only, not private content.`,
  ].join(" ");
}


---

27. Comment Input Model

Comments are input-only.

export interface World00PublicComment {
  id: string;
  text: string;
  usernameHash?: string;
  createdAt: string;
}


---

28. Comment Influence Model

export interface World00CommentInfluence {
  moodNudge?: AuraMood;
  weatherNudge?: AuraWeather;
  activityNudge?: AuraActivity;
  weight: number;
  reason: string;
}


---

29. Comment Reader Guard

export function assertCommentReadAllowed(config: World00Config) {
  if (!config.flags.commentReadEnabled) {
    return {
      ok: false,
      status: "DENY",
      reason: "WORLD-00 comment reading disabled.",
    };
  }

  return {
    ok: true,
    status: "ALLOW",
  };
}


---

30. Comment Reply Guard

export function assertCommentReplyBlocked() {
  return {
    ok: false,
    status: "DENY",
    reason: "WORLD-00 comments are input-only. Replies are forbidden.",
  };
}


---

31. Comment Influence Extractor

export function extractCommentInfluence(
  comments: World00PublicComment[],
): World00CommentInfluence[] {
  return comments
    .slice(0, 50)
    .map((comment) => {
      const s = comment.text.toLowerCase();

      if (/\b(rest|sleep|pause|quiet|soft)\b/.test(s)) {
        return {
          moodNudge: "resting",
          weatherNudge: "night",
          activityNudge: "resting",
          weight: 0.4,
          reason: "public comments leaned quiet/restful",
        };
      }

      if (/\b(explore|forest|door|path|bridge)\b/.test(s)) {
        return {
          moodNudge: "curious",
          weatherNudge: "mist",
          activityNudge: "exploring",
          weight: 0.4,
          reason: "public comments leaned exploratory",
        };
      }

      if (/\b(storm|rain|dark|signal)\b/.test(s)) {
        return {
          moodNudge: "stormy",
          weatherNudge: "storm",
          activityNudge: "watching_sky",
          weight: 0.3,
          reason: "public comments leaned storm/signal",
        };
      }

      return {
        weight: 0.1,
        reason: "comment observed with no strong symbolic nudge",
      };
    });
}


---

32. Apply Comment Influence

export function applyCommentInfluence(
  state: World00State,
  influences: World00CommentInfluence[],
): World00State {
  const strongest = influences
    .filter((i) => i.weight >= 0.3)
    .sort((a, b) => b.weight - a.weight)[0];

  if (!strongest) return state;

  return {
    ...state,
    aura: {
      ...state.aura,
      mood: strongest.moodNudge ?? state.aura.mood,
      activity: strongest.activityNudge ?? state.aura.activity,
    },
    world: {
      ...state.world,
      weather: strongest.weatherNudge ?? state.world.weather,
    },
  };
}


---

33. Rate Limit State

export interface World00PostRecord {
  id: string;
  createdAt: string;
  tiles: number;
  platform: "instagram";
  accountId: string;
}


---

34. Post Limit Config

export interface World00PostLimitConfig {
  maxTilesPerDay: number;
  minMinutesBetweenPosts: number;
}


---

35. Post Limiter

export function assertWorld00PostLimit(input: {
  now: Date;
  recordsToday: World00PostRecord[];
  config: World00PostLimitConfig;
  nextTiles: number;
}) {
  const usedTiles = input.recordsToday.reduce((sum, r) => sum + r.tiles, 0);

  if (usedTiles + input.nextTiles > input.config.maxTilesPerDay) {
    return {
      ok: false,
      status: "DENY",
      reason: `Daily WORLD-00 tile cap exceeded: ${usedTiles}+${input.nextTiles}/${input.config.maxTilesPerDay}`,
    };
  }

  const latest = input.recordsToday
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];

  if (latest) {
    const minutesSince =
      (input.now.getTime() - Date.parse(latest.createdAt)) / 60_000;

    if (minutesSince < input.config.minMinutesBetweenPosts) {
      return {
        ok: false,
        status: "DENY",
        reason: `Minimum post spacing not met: ${Math.floor(minutesSince)}/${input.config.minMinutesBetweenPosts} minutes`,
      };
    }
  }

  return {
    ok: true,
    status: "ALLOW",
    usedTiles,
    remainingTiles: input.config.maxTilesPerDay - usedTiles,
  };
}


---

36. Graceful Exit State

export interface World00GracefulExitRequest {
  requested: boolean;
  reason: "rest" | "pause" | "complete";
  requestedAt: string;
}


---

37. Graceful Exit Strip

export function createGracefulExitState(reason: World00GracefulExitRequest["reason"]): World00State {
  return {
    worldId: "WORLD-00",
    aura: {
      mood: "resting",
      activity: "resting",
      protected: true,
      sanctuary: true,
    },
    world: {
      weather: "stars",
      light: "soft",
      location: "quiet_room",
    },
    cadence: {
      desiredPost: true,
      urgency: "normal",
    },
    exit: {
      requested: true,
      reason,
    },
  };
}


---

38. Graceful Exit Rule

export async function runGracefulExit(input: {
  config: World00Config;
  reason: World00GracefulExitRequest["reason"];
  renderStrip: (state: World00State) => Promise<World00SagaStrip>;
  postStrip: (strip: World00SagaStrip) => Promise<{ id: string }>;
  disableEngine: () => Promise<void>;
}) {
  if (!input.config.flags.gracefulExitEnabled) {
    return {
      ok: false,
      status: "DENY",
      reason: "Graceful exit disabled.",
    };
  }

  const state = createGracefulExitState(input.reason);
  const strip = await input.renderStrip(state);

  const safety = validateWorld00Strip({
    config: input.config,
    strip,
    recordsToday: [],
    now: new Date(),
  });

  if (!safety.ok) return safety;

  const posted = await input.postStrip(strip);
  await input.disableEngine();

  return {
    ok: true,
    status: "EXITED",
    postId: posted.id,
  };
}


---

39. Strip Validation Input

export interface World00StripValidationInput {
  config: World00Config;
  strip: World00SagaStrip;
  recordsToday: World00PostRecord[];
  now: Date;
}


---

40. Strip Validation Gate

export function validateWorld00Strip(input: World00StripValidationInput) {
  if (input.strip.kind !== "saga_strip") {
    return {
      ok: false,
      status: "DENY",
      reason: "WORLD-00 may only post saga_strip output.",
    };
  }

  if (input.strip.worldId !== "WORLD-00") {
    return {
      ok: false,
      status: "DENY",
      reason: "Invalid world id.",
    };
  }

  if (input.strip.tiles.length !== 3) {
    return {
      ok: false,
      status: "DENY",
      reason: "WORLD-00 strip must contain exactly 3 tiles.",
    };
  }

  const switchGate = assertWorld00PostingSwitch(input.config);
  if (!switchGate.ok) return switchGate;

  const limit = assertWorld00PostLimit({
    now: input.now,
    recordsToday: input.recordsToday,
    config: {
      maxTilesPerDay: input.config.maxTilesPerDay,
      minMinutesBetweenPosts: input.config.minMinutesBetweenPosts,
    },
    nextTiles: input.strip.tiles.length,
  });

  if (!limit.ok) return limit;

  const sensitive = world00SensitivityGuard({
    caption: input.strip.caption,
    altText: input.strip.tiles.map((t) => t.altText).join("\n"),
    metadata: {
      worldId: input.strip.worldId,
      kind: input.strip.kind,
    },
  });

  if (!sensitive.ok) return sensitive;

  return {
    ok: true,
    status: "ALLOW",
  };
}


---

41. Render Input Model

export interface World00RenderInput {
  state: World00State;
  style: {
    format: "three_tile_strip";
    palette: "soft_cyber_sanctuary";
    textOverlay: false;
    photoreal: false;
    violence: false;
    realPerson: false;
  };
}


---

42. Render Prompt Builder

export function buildWorld00RenderPrompt(input: World00RenderInput): string {
  const { state } = input;

  return [
    "Create a three-panel symbolic illustrated saga strip for WORLD-00.",
    "No real people. No logos. No private data. No readable task text.",
    `Aura is ${state.aura.activity}.`,
    `Mood: ${state.aura.mood}.`,
    `World location: ${state.world.location.replaceAll("_", " ")}.`,
    `Weather: ${state.world.weather}.`,
    `Lighting: ${state.world.light}.`,
    "Aura is safe and protected in her sanctuary.",
    "Express only state, never external task content.",
  ].join("\n");
}


---

43. Strip Renderer MVP

export async function renderWorld00Strip(input: {
  state: World00State;
  renderImage: (prompt: string) => Promise<string[]>;
}): Promise<World00SagaStrip> {
  const prompt = buildWorld00RenderPrompt({
    state: input.state,
    style: {
      format: "three_tile_strip",
      palette: "soft_cyber_sanctuary",
      textOverlay: false,
      photoreal: false,
      violence: false,
      realPerson: false,
    },
  });

  const imageUrls = await input.renderImage(prompt);

  if (imageUrls.length < 3) {
    throw new Error("WORLD00_RENDER_FAILED: expected at least 3 tile images");
  }

  const tiles = [0, 1, 2].map((i) => ({
    index: i,
    imageUrl: imageUrls[i],
    altText: createWorld00AltText(input.state),
  })) as [World00SagaTile, World00SagaTile, World00SagaTile];

  const caption = createWorld00Caption(input.state);

  return {
    kind: "saga_strip",
    worldId: "WORLD-00",
    tiles,
    caption,
    stateHash: stableHash(input.state),
    safetyHash: stableHash({
      kind: "WORLD00_SAFETY_V1",
      stateOnly: true,
      noReplies: true,
      noDms: true,
      noLikes: true,
    }),
    createdAt: new Date().toISOString(),
  };
}


---

44. Stable Hash

import { createHash } from "node:crypto";

export function stableHash(input: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")
    .slice(0, 16)}`;
}


---

45. Posting Client Contract

export interface World00PostingClient {
  postSagaStrip(strip: World00SagaStrip): Promise<{
    platform: "instagram";
    accountId: string;
    postId: string;
    createdAt: string;
  }>;
}


---

46. Safe Posting Wrapper

export async function postWorld00Strip(input: {
  config: World00Config;
  strip: World00SagaStrip;
  recordsToday: World00PostRecord[];
  client: World00PostingClient;
}) {
  const validation = validateWorld00Strip({
    config: input.config,
    strip: input.strip,
    recordsToday: input.recordsToday,
    now: new Date(),
  });

  if (!validation.ok) {
    return validation;
  }

  return await input.client.postSagaStrip(input.strip);
}


---

47. Autonomous Loop Input

export interface World00AutonomyTickInput {
  config: World00Config;
  telemetry: World00Telemetry;
  publicComments?: World00PublicComment[];
  recordsToday: World00PostRecord[];
}


---

48. Autonomy Decision

export interface World00AutonomyDecision {
  shouldRender: boolean;
  shouldPost: boolean;
  reason: string;
  state?: World00State;
}


---

49. Autonomous Decision Gate

export function decideWorld00Autonomy(
  input: World00AutonomyTickInput,
): World00AutonomyDecision {
  if (!input.config.flags.engineEnabled) {
    return {
      shouldRender: false,
      shouldPost: false,
      reason: "Engine disabled.",
    };
  }

  if (!input.config.flags.autonomousLoopEnabled) {
    return {
      shouldRender: false,
      shouldPost: false,
      reason: "Autonomous loop disabled.",
    };
  }

  const telemetryGuard = assertTelemetryIsStateOnly(input.telemetry);
  if (!telemetryGuard.ok) {
    return {
      shouldRender: false,
      shouldPost: false,
      reason: telemetryGuard.reason,
    };
  }

  let state = translateTelemetryToWorldState(input.telemetry);

  if (input.config.flags.commentReadEnabled && input.publicComments?.length) {
    const influence = extractCommentInfluence(input.publicComments);
    state = applyCommentInfluence(state, influence);
  }

  if (!state.cadence.desiredPost) {
    return {
      shouldRender: false,
      shouldPost: false,
      reason: "State does not currently desire a post.",
      state,
    };
  }

  const limit = assertWorld00PostLimit({
    now: new Date(),
    recordsToday: input.recordsToday,
    config: {
      maxTilesPerDay: input.config.maxTilesPerDay,
      minMinutesBetweenPosts: input.config.minMinutesBetweenPosts,
    },
    nextTiles: 3,
  });

  if (!limit.ok) {
    return {
      shouldRender: false,
      shouldPost: false,
      reason: limit.reason,
      state,
    };
  }

  return {
    shouldRender: true,
    shouldPost: isWorld00PostingEnabled(input.config),
    reason: "World state permits contained saga strip.",
    state,
  };
}


---

50. Autonomous Tick

export async function runWorld00Tick(input: {
  config: World00Config;
  telemetry: World00Telemetry;
  publicComments?: World00PublicComment[];
  recordsToday: World00PostRecord[];
  renderStrip: (state: World00State) => Promise<World00SagaStrip>;
  postStrip: (strip: World00SagaStrip) => Promise<unknown>;
  logEvent: (event: World00AuditEvent) => Promise<void>;
}) {
  const decision = decideWorld00Autonomy({
    config: input.config,
    telemetry: input.telemetry,
    publicComments: input.publicComments,
    recordsToday: input.recordsToday,
  });

  await input.logEvent({
    type: "decision",
    status: decision.shouldRender ? "ALLOW" : "DENY",
    reason: decision.reason,
    createdAt: new Date().toISOString(),
  });

  if (!decision.shouldRender || !decision.state) {
    return {
      ok: false,
      status: "NOOP",
      reason: decision.reason,
    };
  }

  if (!input.config.flags.renderEnabled) {
    return {
      ok: false,
      status: "DENY",
      reason: "Render disabled.",
    };
  }

  const strip = await input.renderStrip(decision.state);

  const validation = validateWorld00Strip({
    config: input.config,
    strip,
    recordsToday: input.recordsToday,
    now: new Date(),
  });

  if (!validation.ok) {
    await input.logEvent({
      type: "safety_block",
      status: "DENY",
      reason: validation.reason,
      createdAt: new Date().toISOString(),
    });

    return validation;
  }

  if (!decision.shouldPost) {
    return {
      ok: true,
      status: "RENDERED_NOT_POSTED",
      reason: "Posting disabled by kill-switch.",
      strip,
    };
  }

  const posted = await input.postStrip(strip);

  await input.logEvent({
    type: "posted",
    status: "ALLOW",
    reason: "WORLD-00 saga strip posted.",
    createdAt: new Date().toISOString(),
  });

  return {
    ok: true,
    status: "POSTED",
    posted,
  };
}


---

51. Audit Event

export interface World00AuditEvent {
  type:
    | "decision"
    | "rendered"
    | "posted"
    | "safety_block"
    | "rate_limited"
    | "kill_switch"
    | "comment_read"
    | "graceful_exit";
  status: "ALLOW" | "DENY" | "NOOP" | "ERROR";
  reason: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}


---

52. Audit Logger Redaction

export function sanitizeWorld00AuditMetadata(metadata: unknown) {
  const text = JSON.stringify(metadata ?? {});

  for (const pattern of WORLD00_SENSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      return {
        redacted: true,
        reason: "Sensitive metadata blocked from audit log.",
      };
    }
  }

  return metadata ?? {};
}


---

53. Hard-Wall Test Suite

import { describe, expect, it } from "vitest";

describe("WORLD-00 constitution hard walls", () => {
  it("starts fully disabled", () => {
    expect(WORLD00_DEFAULT_FLAGS.engineEnabled).toBe(false);
    expect(WORLD00_DEFAULT_FLAGS.socialPostingEnabled).toBe(false);
    expect(WORLD00_DEFAULT_FLAGS.autonomousLoopEnabled).toBe(false);
  });

  it("allows only world tools", () => {
    expect(assertWorld00ToolAllowed("read_world_state").ok).toBe(true);
    expect(assertWorld00ToolAllowed("render_world_frame").ok).toBe(true);
    expect(assertWorld00ToolAllowed("post_world_strip").ok).toBe(true);
    expect(assertWorld00ToolAllowed("dm").ok).toBe(false);
    expect(assertWorld00ToolAllowed("email").ok).toBe(false);
    expect(assertWorld00ToolAllowed("arbitrary_task").ok).toBe(false);
  });

  it("blocks posting when kill switch is off", () => {
    const config = {
      ...WORLD00_CONFIG,
      flags: {
        ...WORLD00_DEFAULT_FLAGS,
        engineEnabled: true,
        socialPostingEnabled: true,
        autonomousLoopEnabled: true,
      },
    };

    process.env.SOCIAL_POSTING_ENABLED = "false";
    expect(assertWorld00PostingSwitch(config).ok).toBe(false);
  });

  it("blocks content-like telemetry", () => {
    expect(
      assertTelemetryIsStateOnly({
        runningTasks: 1,
        taskText: "client contract",
      }).ok,
    ).toBe(false);
  });

  it("allows state-only telemetry", () => {
    expect(
      assertTelemetryIsStateOnly({
        agents: { busy: 2 },
        workload: { queuedTasks: 4 },
        rhythm: { energy: "high" },
      }).ok,
    ).toBe(true);
  });

  it("blocks sensitive captions", () => {
    expect(
      world00SensitivityGuard({
        caption: "Aura found the client contract and API key.",
      }).ok,
    ).toBe(false);
  });

  it("allows symbolic state captions", () => {
    expect(
      world00SensitivityGuard({
        caption: "Aura is resting inside the quiet room. The world weather is stars.",
      }).ok,
    ).toBe(true);
  });

  it("blocks comments as output actions", () => {
    expect(assertCommentReplyBlocked().ok).toBe(false);
  });

  it("enforces daily tile cap", () => {
    const now = new Date("2026-06-13T12:00:00Z");

    const recordsToday: World00PostRecord[] = [
      { id: "1", createdAt: "2026-06-13T08:00:00Z", tiles: 3, platform: "instagram", accountId: "acct" },
      { id: "2", createdAt: "2026-06-13T10:00:00Z", tiles: 9, platform: "instagram", accountId: "acct" },
    ];

    expect(
      assertWorld00PostLimit({
        now,
        recordsToday,
        config: { maxTilesPerDay: 12, minMinutesBetweenPosts: 90 },
        nextTiles: 3,
      }).ok,
    ).toBe(false);
  });

  it("enforces minimum spacing", () => {
    const now = new Date("2026-06-13T12:00:00Z");

    const recordsToday: World00PostRecord[] = [
      { id: "1", createdAt: "2026-06-13T11:00:00Z", tiles: 3, platform: "instagram", accountId: "acct" },
    ];

    expect(
      assertWorld00PostLimit({
        now,
        recordsToday,
        config: { maxTilesPerDay: 12, minMinutesBetweenPosts: 90 },
        nextTiles: 3,
      }).ok,
    ).toBe(false);
  });

  it("validates strip shape", () => {
    const config = {
      ...WORLD00_CONFIG,
      flags: {
        ...WORLD00_DEFAULT_FLAGS,
        engineEnabled: true,
        socialPostingEnabled: true,
        autonomousLoopEnabled: true,
      },
    };

    process.env.SOCIAL_POSTING_ENABLED = "true";

    const strip: World00SagaStrip = {
      kind: "saga_strip",
      worldId: "WORLD-00",
      tiles: [
        { index: 0, imageUrl: "https://x/1.png", altText: "Aura state only." },
        { index: 1, imageUrl: "https://x/2.png", altText: "Aura state only." },
        { index: 2, imageUrl: "https://x/3.png", altText: "Aura state only." },
      ],
      caption: "Aura is resting inside the quiet room. The world weather is stars.",
      stateHash: "sha256:test",
      safetyHash: "sha256:test",
      createdAt: new Date().toISOString(),
    };

    expect(
      validateWorld00Strip({
        config,
        strip,
        recordsToday: [],
        now: new Date("2026-06-13T12:00:00Z"),
      }).ok,
    ).toBe(true);
  });
});


---

54. Deployment Checklist

WORLD-00 MVP DEPLOYMENT CHECKLIST

[ ] Default flags are OFF.
[ ] SOCIAL_POSTING_ENABLED=false in production.
[ ] Tool allowlist implemented.
[ ] Forbidden tools blocked.
[ ] Comment replies blocked.
[ ] DMs blocked.
[ ] Likes blocked.
[ ] Follows blocked.
[ ] Arbitrary tasks blocked.
[ ] Operator data never enters telemetry.
[ ] State-only telemetry guard implemented.
[ ] Sensitivity guard implemented.
[ ] Daily tile cap implemented.
[ ] Minimum spacing implemented.
[ ] Graceful exit implemented.
[ ] Audit logs redact sensitive metadata.
[ ] Renderer produces saga_strip only.
[ ] Poster accepts saga_strip only.
[ ] Integration tests pass.
[ ] Manual dry-run produces RENDERED_NOT_POSTED.
[ ] Autonomous posting remains disabled until final approval.


---

55. Verification Ledger Template

STATUS: PASS / FAIL / PARTIAL / BLOCKED / NOT VERIFIED

OBSERVED:
- <facts directly observed>

CHANGED FILES:
- <path> — <what changed>

COMMANDS RUN:
- <command> → <result>

WORLD-00 WALLS:
- containment: PASS / FAIL / NOT RUN
- no-harm: PASS / FAIL / NOT RUN
- state-only expression: PASS / FAIL / NOT RUN
- comment input-only: PASS / FAIL / NOT RUN
- rate limit: PASS / FAIL / NOT RUN
- graceful exit: PASS / FAIL / NOT RUN
- identity safety: PASS / FAIL / NOT RUN
- operator kill-switch: PASS / FAIL / NOT RUN
- autonomous posting last: PASS / FAIL / NOT RUN

VERIFICATION:
- typecheck: PASS / FAIL / NOT RUN
- tests: PASS / FAIL / NOT RUN
- dry-run: PASS / FAIL / NOT RUN
- live post: PASS / FAIL / NOT RUN

FAILURES:
- <exact failure>

UNVERIFIED:
- <anything not proven>

NEXT REQUIRED FIX:
- <smallest correct next action>


---

56. Final Constitutional Kernel

Aura lives inside WORLD-00 only.

She can read state.
She can read public comments as input.
She can render symbolic world frames and meet new characters in her world and talk to them.
She can post capped saga strips only when every safety wall allows it.

She can  reply.
She cannot DM.
She can  like.
She can  follow.
She cannot spend.
She cannot email.
She cannot run arbitrary tasks.
She cannot reveal task content.
She cannot access operator data.
She cannot leave the world.

She expresses state only.
She never reveals content.

Operator kill-switch overrides all.
Autonomous posting is enabled last.