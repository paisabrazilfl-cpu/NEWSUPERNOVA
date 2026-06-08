import { createHash } from "node:crypto";

/**
 * Grounding proof / observability for Agentic Source-Grounded Orchestration.
 *
 * Produces a safe fingerprint that the operator's source material actually
 * reached a stage (ABBY planning, a CLAW dispatch). Logs length + a short hash
 * ONLY — never the raw content — so we can prove grounding without leaking
 * sensitive material. (Vocabulary: Grounding Proof, Context Hash, Context
 * Length Logging, Context Integrity Check.)
 */
export interface GroundingProof {
  received: boolean;
  chars: number;
  hash: string;
}

export function groundingProof(sourceContext?: string | null): GroundingProof {
  const s = (sourceContext ?? "").trim();
  if (!s) return { received: false, chars: 0, hash: "" };
  return {
    received: true,
    chars: s.length,
    hash: "sha256:" + createHash("sha256").update(s).digest("hex").slice(0, 12),
  };
}
