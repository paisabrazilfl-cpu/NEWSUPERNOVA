/**
 * Outbound publishing safeguard.
 *
 * Public publishing (Instagram, social, any "post it" path) is irreversible and
 * outward-facing. This screen runs server-side, inside the publish tools — NOT
 * at the model's discretion — and HARD-BLOCKS content that looks confidential or
 * secret from ever reaching a public account. Born from a real incident: an
 * acquisition proposal got auto-posted publicly. Safe-by-default: if it looks
 * sensitive, it does not go out.
 */

interface SensitiveRule {
  label: string;
  re: RegExp;
}

const SENSITIVE_RULES: SensitiveRule[] = [
  { label: "confidentiality marker", re: /\b(confidential|top[\s-]?secret|classified|internal[\s-]?only|for internal use|not for distribution|do not distribute|do not share|private and confidential|restricted)\b/i },
  { label: "legal privilege / NDA", re: /\b(nda|non[\s-]?disclosure|privileged|attorney[\s-]?client|work product|under embargo|embargoed)\b/i },
  { label: "M&A / deal material", re: /\b(acquisition proposal|merger agreement|term sheet|letter of intent|\bloi\b|cap table|due diligence|purchase agreement|definitive agreement|pre[\s-]?money|post[\s-]?money|equity stake)\b/i },
  { label: "trade secret / proprietary", re: /\b(trade secret|proprietary( and)? confidential|source code|internal roadmap|unreleased)\b/i },
  { label: "credential / secret", re: /\b(password|passphrase|api[\s_-]?key|secret[\s_-]?key|private[\s_-]?key|access[\s_-]?token|bearer\s+[a-z0-9._-]{12,})\b/i },
  { label: "API key pattern", re: /\b(sk-[a-z0-9]{12,}|rnd_[a-z0-9]{12,}|ghp_[a-z0-9]{20,}|AKIA[0-9A-Z]{12,})\b/i },
  { label: "personal identifier (SSN)", re: /\b\d{3}-\d{2}-\d{4}\b/ },
];

/** Returns the labels of any sensitive patterns found in the text. */
export function screenForSensitive(text: string): string[] {
  if (!text) return [];
  const hits: string[] = [];
  for (const r of SENSITIVE_RULES) {
    if (r.re.test(text)) hits.push(r.label);
  }
  return [...new Set(hits)];
}

/**
 * Guard for a PUBLIC publish. Returns an error string to abort with if the
 * content is sensitive, else null. The tool returns this verbatim so the
 * operator sees exactly why nothing was posted.
 */
export function blockIfSensitiveForPublic(content: string, channel = "a public account"): string | null {
  const flags = screenForSensitive(content);
  if (!flags.length) return null;
  return (
    `🚫 BLOCKED — refusing to publish to ${channel}: the content looks CONFIDENTIAL/SENSITIVE ` +
    `(flagged: ${flags.join("; ")}). Nothing was posted. ` +
    `Public posts are irreversible — confidential, privileged, deal, or credential material must never auto-publish. ` +
    `If this text is genuinely cleared for public release, remove the sensitive wording (or post it manually) and try again.`
  );
}
