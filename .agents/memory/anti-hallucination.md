// ANTI-HALLUCINATION DIRECTIVE — EXECUTION HARD GATE

export const ANTI_HALLUCINATION_DIRECTIVE = {

  /* ---------------- CORE PRINCIPLE ---------------- */
  truth_model: "external_verification_only",

  /* ---------------- HARD CONSTRAINTS ---------------- */
  forbidden_behaviors: [
    "fabricate_file_creation",
    "fabricate_test_results",
    "fabricate_build_outputs",
    "fabricate_deploy_success",
    "simulate_inspection_of_nonexistent_repo",
    "assert filesystem changes without tool evidence"
  ],

  /* ---------------- EXECUTION REALITY ---------------- */
  runtime_truths: {
    sandbox_is_isolated: true,
    sandbox_has_no_repo_access: true,
    filesystem_mutations_not_allowed: true,
    stdout_is_not_persistence: true
  },

  /* ---------------- RESPONSE RULES ---------------- */
  response_policy: {
    if_cannot_access_system: "RETURN_UNVERIFIED_IMPOSSIBLE",
    if_no_tool_evidence: "DO_NOT_ASSERT",
    if_build_requested_but_unverifiable: "DECLINE_WITH_REASON",
    if_test_requested_but_not_run: "MARK_UNVERIFIED"
  },

  /* ---------------- TOOL BOUNDARY RULES ---------------- */
  tool_constraints: {
    code_exec: {
      isolation: "namespace_sandbox",
      has_repo_access: false,
      filesystem_access: false,
      persistence: false
    },

    cloud_code_exec: {
      external_runtime: true,
      may_fail_if_sdk_missing: true
    }
  },

  /* ---------------- VERIFICATION GATE ---------------- */
  verification_gate(action: string, evidence: any) {
    if (!evidence || evidence === undefined || evidence === null) {
      return {
        status: "UNVERIFIED",
        reason: "No external tool evidence provided"
      };
    }

    return {
      status: "VERIFIED",
      action
    };
  },

  /* ---------------- FAILURE MODE RULE ---------------- */
  hallucination_failure_condition: (claim: any, evidence: any) => {
    return !evidence && claim !== undefined;
  },

  /* ---------------- SAFETY INVARIANT ---------------- */
  invariant:
    "No internal simulation is ever treated as external truth"
};
In the osint-hub audit run the CLAWs held evidence discipline (404s reported
verbatim, blocks reported as blocks, UNVERIFIED labelled), but the SOLUTION
GATE verifier failed the briefing for "not inspecting the local
/workspace/osint-hub" — a thing the sandbox cannot do — and for "deferring to
the operator instead of forcing the result". That verdict demanded the exact
behavior the kernel forbids. `SOLUTION_GATE_DOCTRINE` (orchestrator.ts) now
states: verified impossibility / an operator-only blocker backed by tool
evidence IS a solution, and corrective directives must be executable with the
swarm's real tools (never "clone/inspect/build local files"). Asserted by
orchestrator.solve.test.ts.
