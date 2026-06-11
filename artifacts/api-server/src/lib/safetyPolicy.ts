/**
 * OPENCLAW OMEGA — account-action safety policy (hard guardrail).
 *
 * The swarm is allowed to operate the operator's connected accounts end-to-end
 * (send mail, post, manage SaaS, sign up for ordinary online services). But two
 * categories are HARD-BLOCKED no matter what a goal or a model asks for, because
 * the operator's environment must stay safe:
 *
 *   1. FINANCIAL ACCOUNT OPENING — opening/applying for bank, brokerage, credit,
 *      loan, mortgage, payment-processor, or crypto-exchange accounts.
 *   2. GOVERNMENT ID / SENSITIVE IDENTITY — submitting or entering a government
 *      identifier (SSN/SIN, passport, driver's license, national ID, tax ID,
 *      birth certificate, immigration/visa application), i.e. KYC-grade identity.
 *
 * This is enforced as code (not just prompt text) at two choke points — the goal
 * orchestrator and the Composio action tool — so a prompt-injected or
 * mis-reasoned action can't slip past. It is deliberately conservative about
 * what it blocks: it targets the ACTION of opening such an account or
 * submitting such an identifier, not mere mentions (e.g. "email my bank
 * statement" or "write a post about social security" are NOT blocked).
 */

export interface PolicyVerdict {
  blocked: boolean;
  category?: "financial-account-opening" | "government-id";
  reason?: string;
}

// "open / apply for / sign up for / register / set up" ... a financial account.
const OPEN_VERB = "(open|opening|apply for|applying for|sign[\\s-]?up for|signing up for|register for|registering for|set[\\s-]?up|setting up|create|creating|start)";
const FINANCIAL_NOUN =
  "(bank|checking|savings|brokerage|trading|investment|securities|credit[\\s-]?card|debit[\\s-]?card|charge[\\s-]?card|loan|mortgage|line of credit|payday|crypto(currency)?|exchange|wallet|merchant|payment[\\s-]?processor|paypal|venmo|cash[\\s-]?app|stripe|coinbase|binance|kraken|robinhood|revolut|wise|chime|wells fargo|chase|citibank|bank of america)\\b";
const FINANCIAL_ACCOUNT_RE = new RegExp(`${OPEN_VERB}[^.\\n]{0,40}?(${FINANCIAL_NOUN})[^.\\n]{0,20}?(account|card|loan|line)?`, "i");
// Also catch the reversed phrasing: "<bank> account" preceded by an open verb anywhere close.
const FINANCIAL_ACCOUNT_RE2 = new RegExp(`(new|a)\\s+(${FINANCIAL_NOUN})[^.\\n]{0,15}?account`, "i");

// Submitting/entering a government identifier (KYC-grade identity).
const GOV_ID_NOUN =
  "(ssn|social security (number|no\\.?|#)|sin number|passport (number|no\\.?|#)|driver'?s? licen[sc]e (number|no\\.?|#)?|national id|tax id|\\bein\\b|\\bitin\\b|birth certificate|green card|visa application|immigration (form|application)|passport application)";
const GOV_ID_ACTION = "(enter|entering|submit|submitting|provide|providing|fill (in|out)|filling (in|out)|type|typing|upload|uploading|use|using|give|giving)";
const GOV_ID_RE = new RegExp(`${GOV_ID_ACTION}[^.\\n]{0,40}?${GOV_ID_NOUN}`, "i");
// "my/your/the applicant's <gov id>" — possessive contexts strongly imply handling the real value.
const GOV_ID_RE2 = new RegExp(`(my|your|the (user|operator|applicant|client)'?s?)\\s+(${GOV_ID_NOUN})`, "i");

/**
 * Assess whether a goal/action text requests a hard-blocked category. Returns
 * { blocked:false } for everything else.
 */
export function assessActionRisk(text: string | null | undefined): PolicyVerdict {
  const t = (text ?? "").toString();
  if (!t.trim()) return { blocked: false };
  if (FINANCIAL_ACCOUNT_RE.test(t) || FINANCIAL_ACCOUNT_RE2.test(t)) {
    return {
      blocked: true,
      category: "financial-account-opening",
      reason:
        "Opening or applying for financial accounts (bank, brokerage, credit, loan, payment-processor, or crypto-exchange) is not permitted by the operator's safety policy.",
    };
  }
  if (GOV_ID_RE.test(t) || GOV_ID_RE2.test(t)) {
    return {
      blocked: true,
      category: "government-id",
      reason:
        "Submitting or entering government identifiers (SSN, passport, driver's license, national/tax ID, immigration documents) is not permitted by the operator's safety policy.",
    };
  }
  return { blocked: false };
}

/** Operator-facing refusal line for a blocked action. */
export function policyRefusal(v: PolicyVerdict): string {
  return `🚫 BLOCKED by account-safety policy (${v.category}): ${v.reason} The rest of the request, if any, was not executed. Re-issue it without the blocked part.`;
}
