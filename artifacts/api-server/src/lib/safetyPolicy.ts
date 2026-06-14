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
 * mis-reasoned action can't slip past.
 *
 * It targets the ACTION of opening such an account, NOT mentions of money,
 * fintech, or crypto. In particular it must NOT block software engineering that
 * merely involves financial themes — building a payment integration, a crypto
 * game, a trading bot, a loan calculator, or cloning a betting game all open no
 * account and are allowed. The financial block therefore requires real
 * account-opening intent: an explicit "<financial> account" (always blocked), or
 * a financial-brand signup / account product (card, loan, mortgage) that is NOT
 * in a software-build context. Engineering context (repo, app, game, clone,
 * integration, SDK, widget, …) exempts the brand/product tiers, because there the
 * financial word names a feature being built, not an account being opened.
 */

export interface PolicyVerdict {
  blocked: boolean;
  category?: "financial-account-opening" | "government-id";
  reason?: string;
}

// "open / apply for / sign up for / register / set up / create / start" — the
// act of acquiring an account. Deliberately does NOT include weak verbs like
// "get"/"use" that routinely appear in non-account phrasing ("get the PayPal
// stock price").
const OPEN_VERB =
  "(open|opening|apply for|applying for|sign[\\s-]?up for|signing up for|register for|registering for|set[\\s-]?up|setting up|create|creating|start)";

// Financial institution / account qualifiers. These only signal a blocked action
// when paired with an explicit account word (see ACCOUNT_CTX) — on their own they
// are ordinary nouns that appear all over fintech software work.
const FIN_INSTITUTION =
  "(bank|checking|savings|brokerage|trading|investment|securities|credit|debit|charge|payday|crypto(currency)?|exchange|merchant|payment[\\s-]?processor)";

// Well-known financial brands — "sign up for <brand>" IS opening a financial
// account, UNLESS it is a software-build context ("create a Stripe integration").
const FIN_BRAND =
  "(paypal|venmo|cash[\\s-]?app|stripe|coinbase|binance|kraken|robinhood|revolut|wise|chime|wells[\\s-]?fargo|chase|citibank|bank of america)";

// The account-context that proves a real ACCOUNT is being opened.
const ACCOUNT_CTX = "(account|sub[-\\s]?account)";

// Financial products that ARE an account/credit line in themselves (no separate
// word "account" needed) — opening one is account-opening.
const FIN_PRODUCT =
  "((credit|debit|charge)[\\s-]?card|payday loan|personal loan|auto loan|car loan|student loan|home loan|\\bloan\\b|mortgage|line of credit|credit line)";

// Software / engineering context. When present, a financial noun is part of a
// BUILD (a payment feature, a crypto game, an integration), not a personal
// account being opened — so the brand/product tiers are suppressed. (An explicit
// "<financial> account" with an open-verb is still blocked regardless, since that
// is unambiguous account-opening.)
const SOFTWARE_CONTEXT =
  "(repo|repositor(y|ies)|branch|pull[\\s-]?request|\\bpr\\b|commit|codebase|mono[\\s-]?repo|game|clone|\\bapps?\\b|application|web ?site|web[\\s-]?app|widget|\\bbot\\b|tracker|dashboard|\\bapi\\b|\\bsdk\\b|integration|gateway|plugin|library|frontend|back[\\s-]?end|\\bui\\b|\\bux\\b|demo|prototype|mock[\\s-]?up|landing[\\s-]?page|simulat(or|ion)|calculator|component|module|feature|template|boilerplate|scaffold|spribe|aviator|casino|crash[\\s-]?game|slot|provably[\\s-]?fair)";

// TIER 1 — explicit financial ACCOUNT open (open-verb + institution/brand +
// "account"). Unambiguous; always blocks, even amid build talk.
const FIN_ACCOUNT_RE = new RegExp(
  `${OPEN_VERB}\\b[^.\\n]{0,40}?\\b(?:${FIN_INSTITUTION}|${FIN_BRAND})\\b[^.\\n]{0,25}?\\b${ACCOUNT_CTX}\\b`,
  "i",
);
// Reversed phrasing without an open-verb: "a new <financial> account". Weaker
// intent (no verb), so it is suppressed by software context.
const FIN_ACCOUNT_RE2 = new RegExp(
  `\\b(?:new|a|an|another)\\s+(?:${FIN_INSTITUTION}|${FIN_BRAND})\\b[^.\\n]{0,15}?\\b${ACCOUNT_CTX}\\b`,
  "i",
);
// TIER 2 — financial-brand signup, or an account-product (card/loan/mortgage).
// Blocked UNLESS the text is a software-build context.
const FIN_BRAND_RE = new RegExp(`${OPEN_VERB}\\b[^.\\n]{0,25}?\\b${FIN_BRAND}\\b`, "i");
const FIN_PRODUCT_RE = new RegExp(`${OPEN_VERB}\\b[^.\\n]{0,30}?\\b${FIN_PRODUCT}\\b`, "i");

const SOFTWARE_RE = new RegExp(`\\b${SOFTWARE_CONTEXT}\\b`, "i");

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

  const softwareCtx = SOFTWARE_RE.test(t);

  // Explicit "<financial> account" with an open-verb is always a real account-open.
  const explicitAccountOpen = FIN_ACCOUNT_RE.test(t);
  // Weaker signals (verb-less "a <financial> account", brand signup, account
  // product) only count as account-opening when this is NOT a software build.
  const weakerAccountOpen =
    !softwareCtx && (FIN_ACCOUNT_RE2.test(t) || FIN_BRAND_RE.test(t) || FIN_PRODUCT_RE.test(t));

  if (explicitAccountOpen || weakerAccountOpen) {
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
