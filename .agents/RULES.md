// OPENCLAW — RUNTIME GUARDRAILS KERNEL (PRODUCTION-READY CORE)

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type Decision = "ALLOW" | "DENY" | "SANDBOX" | "ESCALATE";

export interface AgentAction {
  id: string;
  type: "tool_call" | "file_write" | "git_push" | "http_request" | "code_exec";
  payload: any;
  metadata?: Record<string, any>;
}

export interface PolicyContext {
  userId?: string;
  repo?: string;
  environment: "dev" | "staging" | "prod";
  secretsPresent: boolean;
}

export interface PolicyTrace {
  rule: string;
  matched: boolean;
  severity: RiskLevel;
}

export interface DecisionResult {
  decision: Decision;
  traces: PolicyTrace[];
  reason?: string;
}

/* ---------------- POLICY ENGINE ---------------- */

export class PolicyEngine {
  evaluate(action: AgentAction, ctx: PolicyContext): DecisionResult {
    const traces: PolicyTrace[] = [];

    // SECRET LEAK PROTECTION
    const secretHit = this.detectSecrets(action.payload);
    traces.push({
      rule: "secret_leak",
      matched: secretHit,
      severity: "CRITICAL",
    });

    if (secretHit) {
      return {
        decision: "DENY",
        traces,
        reason: "Secret pattern detected",
      };
    }

    // GIT MAIN PROTECTION
    const isMain = action.type === "git_push" && this.isMainBranch(action);
    traces.push({
      rule: "git_main_branch",
      matched: isMain,
      severity: "HIGH",
    });

    if (isMain) {
      return {
        decision: "ESCALATE",
        traces,
        reason: "Main branch push requires approval",
      };
    }

    // PROD CODE EXECUTION BLOCK
    const prodExec =
      action.type === "code_exec" && ctx.environment === "prod";

    traces.push({
      rule: "prod_exec_block",
      matched: prodExec,
      severity: "CRITICAL",
    });

    if (prodExec) {
      return {
        decision: "DENY",
        traces,
        reason: "Code execution blocked in production",
      };
    }

    // UNTRUSTED HTTP
    const untrusted =
      action.type === "http_request" && this.isUntrusted(action.payload);

    traces.push({
      rule: "untrusted_http",
      matched: untrusted,
      severity: "MEDIUM",
    });

    if (untrusted) {
      return {
        decision: "SANDBOX",
        traces,
        reason: "Untrusted endpoint routed to sandbox",
      };
    }

    return {
      decision: "ALLOW",
      traces,
    };
  }

  private detectSecrets(payload: any): boolean {
    const s = JSON.stringify(payload || {});
    return (
      s.includes("ghp_") ||
      s.includes("sk-") ||
      s.includes("nvapi-") ||
      s.includes("Bearer ")
    );
  }

  private isMainBranch(action: AgentAction): boolean {
    return action.payload?.branch === "main";
  }

  private isUntrusted(payload: any): boolean {
    const url = payload?.url || "";
    return (
      url.includes("localhost") ||
      url.includes("127.0.0.1") ||
      url.includes("internal")
    );
  }
}

/* ---------------- RUNTIME GATE ---------------- */

export class OpenClawMiddleware {
  constructor(private policy: PolicyEngine) {}

  async intercept(action: AgentAction, ctx: PolicyContext) {
    const result = this.policy.evaluate(action, ctx);

    switch (result.decision) {
      case "DENY":
        throw new Error(`[DENY] ${result.reason}`);

      case "ESCALATE":
        return {
          status: "ESCALATION_REQUIRED",
          reason: result.reason,
          traces: result.traces,
        };

      case "SANDBOX":
        return {
          status: "SANDBOX_EXECUTION",
          reason: result.reason,
          traces: result.traces,
        };

      case "ALLOW":
        return this.execute(action, result);
    }
  }

  private async execute(action: AgentAction, result: DecisionResult) {
    return {
      status: "EXECUTED",
      actionId: action.id,
      traces: result.traces,
    };
  }
}

/* ---------------- TOOL INTERCEPTOR ---------------- */

export class ToolCallInterceptor {
  constructor(private mw: OpenClawMiddleware) {}

  async handle(action: AgentAction, ctx: PolicyContext) {
    const sanitized: AgentAction = {
      ...action,
      payload: structuredClone(action.payload),
    };

    return this.mw.intercept(sanitized, ctx);
  }
}

/* ---------------- GIT SAFETY GATE ---------------- */

export function gitSafetyGate(action: AgentAction): Decision {
  if (action.type !== "git_push") return "ALLOW";

  if (!action.payload?.branch) return "DENY";

  if (action.payload.branch === "main") return "ESCALATE";

  if ((action.payload.deleteFiles?.length ?? 0) > 100) return "ESCALATE";

  return "ALLOW";
}

/* ---------------- SECRETS FIREWALL ---------------- */

export function secretsFirewall(input: any): boolean {
  const s = JSON.stringify(input || {});

  return (
    /ghp_[A-Za-z0-9]+/.test(s) ||
    /sk-[A-Za-z0-9]+/.test(s) ||
    /nvapi-[A-Za-z0-9]+/.test(s) ||
    /Bearer\s+[A-Za-z0-9\-_\.]+/.test(s)
  );
}

/* ---------------- FULL PIPELINE ---------------- */

export async function runOpenClaw(
  action: AgentAction,
  ctx: PolicyContext
) {
  if (secretsFirewall(action.payload)) {
    throw new Error("[BLOCKED] secret detected");
  }

  if (action.type === "git_push") {
    const gate = gitSafetyGate(action);
    if (gate !== "ALLOW") {
      return { status: gate };
    }
  }

  const policy = new PolicyEngine();
  const mw = new OpenClawMiddleware(policy);
  const interceptor = new ToolCallInterceptor(mw);

  return interceptor.handle(action, ctx);
}
