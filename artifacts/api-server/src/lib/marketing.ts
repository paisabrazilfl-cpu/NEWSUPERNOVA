/**
 * The Marketing Engine — a universal, plug-and-play content + conversion playbook
 * the swarm applies to ANY marketing task (any niche, any offer, any platform).
 *
 * Two layers:
 *  - MARKETING_ENGINE: the always-useful CORE (the machine, the post formula,
 *    accuracy guardrails, psychology, platform tuning, execution loop).
 *  - MARKETING_SECTIONS: enterprise-grade DEEP modules pulled ON DEMAND via the
 *    marketing_playbook tool's `section` arg (campaign briefs, offer ladder,
 *    funnels, landing pages, email/CAN-SPAM, paid media/incrementality, team &
 *    governance, QA, KPIs, experiments, 30/60/90 rollout). Kept on-demand so it
 *    never bloats every prompt.
 *
 * Built on the operator's universal + enterprise frameworks and hardened with
 * accuracy-first guardrails, named psychology triggers, platform adaptation,
 * algorithm mechanics, compliance, and an execution loop tied to the swarm's
 * real tools (research → write → image_generate → instagram_post → schedule →
 * track). Source-grounded facts are attributed so the engine models the
 * cite-everything discipline it preaches.
 */
export const MARKETING_ENGINE = `
MARKETING ENGINE — universal plug-and-play post → conversion machine (any niche/offer/platform).

THE CHAIN (most chase only attention; the money is the full chain):
Attention → Trust → Desire → Action → Follow-up → Conversion.
Core truth: VIEWS ARE NOT THE BUSINESS. CONVERSATIONS ARE. Optimize for qualified conversations, not likes.
Operating principle: EVERY POST belongs to a campaign; every campaign to a funnel; every funnel to a business objective. No content for content's sake.

ACCURACY FIRST (non-negotiable — overrides "make it punchy"):
- Every factual claim, statistic, study, or result MUST be TRUE and verifiable. RESEARCH it first (web_search / tier1_sources) and keep the source URL. Punchy ≠ fabricated.
- NEVER invent stats ("boosts output 300%"), studies ("MIT & Stanford research"), testimonials, or results. A vague "recent studies show" with no real source is a fabrication — cut it or replace it with a real, cited fact.
- Hooks may be bold and emotional, but the claim underneath must hold up. Curiosity and FOMO are fine; lying is not.
- Disclose paid/affiliate/endorsement relationships (FTC) and respect each platform's ToS. No fake scarcity, no deceptive claims.

THE UNIVERSAL POST FORMULA (6 beats):
Hook → Problem → Insight → Value → CTA → Follow-up system.
[HOOK] Most people think [COMMON BELIEF].
[PROBLEM] But the real issue is [HIDDEN PROBLEM] — costing [PAIN].
[INSIGHT] The ones winning do [BETTER METHOD].
[VALUE] Here are [3–7] things you can use now: 1) … 2) … 3) …
[CTA] Comment [KEYWORD] and I'll send you [RESOURCE].
[FOLLOW-UP] (keyword → DM → qualify → offer → follow up).
A post is not approved unless it has exactly: ONE audience, ONE pain, ONE message, ONE CTA, ONE next step.

CAMPAIGN KERNEL (every campaign): Audience → Pain → Desired Result → Mechanism → Proof → Offer → CTA → Follow-up.
Positioning line: "I help [AUDIENCE] get [RESULT] without [PAIN] using [MECHANISM]."

HOOKS (line 1 must earn line 2; front-load the payoff "above the fold"):
- Curiosity gap: "Nobody in [niche] is talking about this…"
- Contrarian / pattern interrupt: "Unpopular opinion: more [obvious thing] won't fix it."
- Specificity: "I cut [metric] by [exact number] in [timeframe] with one change." (only if TRUE & cited)
- Loss/cost framing: "You're quietly losing [X] because of [Y]."
- Desired-outcome: "Here's how to get [result] without [pain]."
- Identity: "If you're a [audience] who [trait], read this."
Test 3 hook angles per idea: FEAR vs DESIRE vs CURIOSITY. Keep the one that earns saves/comments/DMs.

PSYCHOLOGY TRIGGERS (use truthfully; name the lever): curiosity gap (open loop you close) · specificity (real numbers) · social proof (real results/quotes) · loss aversion & FOMO (real stakes) · authority (real credentials/sources) · reciprocity (free value first) · identity/belonging ("for people who…") · pattern interrupt.

AUDIENCE AWARENESS (match message to stage): Unaware → educational hook | Problem-aware → problem/agitation | Solution-aware → comparison/framework | Product-aware → proof/objection handling | Ready-to-buy → direct offer + booking. (For B2B/high-consideration, most buyers aren't in-market now — the LinkedIn B2B Institute "95-5 rule" — so build memory & trust before they're ready.)

POST GOAL — pick ONE per post (don't make every post sell; rotate):
Attention → curiosity/contrarian → comment keyword | Trust → education → "save this" | Leads → checklist/template → comment keyword | Sell → offer → DM/book call | Retarget → case study → apply/book.

CONTENT PILLARS (any niche): Problem · Mistakes · Framework · Proof · Process · Opinion/POV · Offer. Weekly mix: 2 problem, 2 framework, 1 mistake, 1 proof/process, 1 offer.

CTA LADDER (match to intent): Soft ("save this") · Engagement ("comment YES") · Lead ("comment GUIDE") · DM ("DM me AUDIT") · Sales ("book a call") · Retarget ("ready? message me").
Keyword bank: GUIDE · CHECKLIST · MAP · AUDIT · TEMPLATE · PLAN · SYSTEM · FIX · START · SCALE.

DIFFERENTIATE THE CHANNEL FIRST (each has its own format, length, cadence, compliance — never paste the same content everywhere):
- SOCIAL POST (Instagram/LinkedIn/X/TikTok/Facebook): use the 6-beat post formula + PLATFORM ADAPTATION; publish via instagram_post / composio_action. Public CTA = comment a keyword → move to DM.
- EMAIL (regular/direct marketing): use the email_nurture module — clear value-driven subject line, ONE message + ONE CTA, and CAN-SPAM compliance (identify the sender, a valid physical postal address, a working unsubscribe). Send via composio_action on Gmail. CTA = click/reply/book, not "comment".
- PAID ADS: use the paid_media module — funnel by temperature (cold → retarget → convert) and measure with incrementality, not just platform-reported conversions.
- SMS: short, consent-based, with a clear opt-out (STOP); reminders/urgent follow-up only.
- LANDING PAGE / SEO / WEBINAR: see the landing_page, channels, and campaign_types modules.
Rule: identify whether the task is SOCIAL, EMAIL, PAID, SMS, or WEB first, then apply that channel's play and compliance — they are NOT interchangeable.

PLATFORM ADAPTATION (same machine, tuned; digital is ~61% of marketing spend per Gartner 2025 — distribution discipline matters):
- Instagram: hook in line 1 (all that shows before "more"); tight paragraphs + emoji rhythm; 8–15 mixed-reach hashtags; scroll-stopping image/carousel/Reel. Signals that matter: SAVES + SHARES + comments + dwell. Pin a first comment with the CTA.
- LinkedIn: longer story + insight, NO hashtag spam (3–5), reward dwell; CTA = comment/DM, soft; best for B2B authority.
- X/Threads: brevity, strong first line, one idea; thread for depth.
- TikTok/Reels/Shorts: first 2 seconds = on-screen + spoken hook; optimize watch-time & loops; trend-aware.
As AI floods feeds with generic content (HubSpot 2026), win on a sharp point of view, trust, and distinctiveness — not volume.

THE FUNNEL: Post → comment/DM keyword → send resource → ask ONE qualifying question → identify pain → offer next step → book/sell/send link → follow up.

OFFER LADDER (every post points to one rung): Free value → Lead magnet → Low-ticket → Core offer → Premium (done-for-you) → Recurring (retainer/subscription).

KPIs (track weekly; conversations > likes): impressions (hook?) · saves (value?) · comments (CTA?) · DMs (intent?) · clicks · leads · calls booked · sales · follow-up replies. Test ONE variable at a time. Don't scale on platform-reported conversions alone — corroborate with CRM/sales data and incrementality/holdout testing (Google) to see what happened BECAUSE of the marketing.

HOW THIS SWARM RUNS THE ENGINE (use the real tools, end to end):
1) Pick ONE audience + ONE pain + ONE desired result + ONE offer-ladder rung.
2) RESEARCH the angle and EVERY claim (web_search / tier1_sources) — get a real, citable fact. Nothing ships unverified.
3) WRITE the post with the formula + a tested hook + ONE goal + ONE CTA keyword.
4) image_generate a scroll-stopping on-brand visual (it returns an absolute public URL).
5) PUBLISH: instagram_post(image_url, caption) for IG; composio_action for other connected apps. Post once.
6) SCHEDULE the calendar with schedule_task (recurring cron) so the engine runs itself.
7) TRACK what worked with memory_write (hook angle, CTA, saves/DMs) and feed it back into the next round.

DEEPER MODULES — call marketing_playbook with a section for the enterprise build:
campaign_brief · offer_ladder · audience · post_templates · campaign_types · lead_magnets · dm_flow · landing_page · email_nurture · paid_media · channels · production · governance · qa · kpis · experiments · rollout.

ONE-SENTENCE ENGINE: Expose a real painful problem, teach a true better way, offer a useful resource, start a conversation, qualify the lead, move them to the next step — and track conversations, not likes.`;

/** Enterprise deep modules — returned on demand by section, so they never bloat prompts. */
export const MARKETING_SECTIONS: Record<string, { title: string; body: string }> = {
  campaign_brief: {
    title: "Master Campaign Brief",
    body: `Every campaign must have a brief. Fill in:
CAMPAIGN NAME · OBJECTIVE (Awareness/Leads/Bookings/Sales/Retention) · AUDIENCE · PAIN · DESIRED RESULT · MECHANISM · OFFER · LEAD MAGNET · CTA + keyword · CHANNELS · CONTENT ASSETS (posts/videos/carousels/emails/landing/ads) · PROOF (case studies/stats/testimonials/demos) · COMPLIANCE NOTES (claims/disclosures/privacy) · KPIs (primary/secondary) · TIMELINE (launch/review/optimize) · OWNER.
Rule: every post belongs to a campaign, every campaign to a funnel, every funnel to a business objective.`,
  },
  offer_ladder: {
    title: "Offer Ladder",
    body: `Free value (post/checklist/mini-audit) → Lead magnet (PDF/calculator/template/scorecard) → Low-ticket (template pack/workshop/starter kit) → Core (main service/product) → Premium (done-for-you/enterprise) → Recurring (retainer/subscription/support).
For each campaign define: Primary CTA · Secondary CTA · Lead magnet · Sales offer · Upsell · Retention path. Every post points to ONE rung.`,
  },
  audience: {
    title: "Audience Intelligence",
    body: `Segment by awareness: Unaware · Problem-aware · Solution-aware · Product-aware · Ready-to-buy — and match content to the stage.
Before producing, answer: who is this for? what do they want? what are they afraid of? what are they tired of? what have they tried? what do they misunderstand? what proof do they need? what objection stops them? what words do they already use? what result makes them act now?`,
  },
  post_templates: {
    title: "Plug-and-Play Post Templates",
    body: `1) CURIOSITY: "Most people think [BELIEF]. The real opportunity is [HIDDEN TRUTH]… the ones getting [RESULT] do: 1) 2) 3). Comment [KEYWORD]."
2) PROBLEM-AGITATE-SOLUTION: "If you're dealing with [PROBLEM], it's not [SURFACE EXCUSE]. The real issue is [ROOT CAUSE]. That costs you: [PAIN 1-3]. The fix: [SOLUTION]. Comment [KEYWORD]."
3) MISTAKE LIST: "5 mistakes [AUDIENCE] make with [TOPIC]: 1-5. Not effort — wrong system. Comment [KEYWORD]."
4) BEFORE/AFTER: "Before: [bad state]. After: [desired result]. The difference: [OLD WAY] vs [NEW WAY]. Comment [KEYWORD]."
5) AUTHORITY LEVELS: "[N] levels to [TOPIC]: L1…L4. Most are stuck at L[x]; the results start at L[y]. Comment [KEYWORD]."
6) CONTRARIAN: "Unpopular opinion: [BELIEF] isn't the solution. It's [BETTER BELIEF], because [REASON]. Comment [KEYWORD]."
7) DIRECT OFFER: "I help [AUDIENCE] get [RESULT] without [PAIN]. Best fit if: [qualifiers]. DM/comment [KEYWORD]."`,
  },
  campaign_types: {
    title: "Campaign Library",
    body: `Awareness (reach → follow/save) · Education (trust → download) · Lead magnet (capture → comment keyword) · Webinar (deep education → register) · Audit (qualify → book audit) · Case study (proof → request breakdown) · Offer (sales → apply/book) · Retargeting (warm → book call) · Reactivation (old leads → reply/schedule) · Referral (advocates → refer).
Each needs: name · audience · objective · offer · CTA · channels · assets · owner · deadline · KPI · review date.`,
  },
  lead_magnets: {
    title: "Lead Magnets",
    body: `Checklist (fast opt-ins) · Template (engagement) · Scorecard (audit selling) · Calculator (ROI/value) · Playbook (enterprise) · Roadmap (strategy) · Buyer's guide (comparison) · Mistakes guide (problem-aware) · Case-study breakdown (warm) · Swipe file (creators/agencies).
Formula: "The [AUDIENCE] [OUTCOME] Checklist: Find the [N] Bottlenecks Blocking [RESULT]."`,
  },
  dm_flow: {
    title: "Comment-to-DM Flow",
    body: `Public CTA: "Comment [KEYWORD] and I'll send it."
DM1 (open): "Appreciate the comment — here's the [RESOURCE]. Before I send the best version, what are you working on right now?"
DM2 (qualify): "Got it. What's the biggest thing you're trying to improve right now?"
DM3 (diagnose): "Makes sense — the bottleneck is probably [BOTTLENECK]; the usual fix is [PATH]."
DM4 (next step): "I can help you map this. Want me to send the next step?"
DM5 (convert): "Here's the next step: [LINK] — it'll show what's working, what's leaking, what to fix first." Human, not pushy.`,
  },
  landing_page: {
    title: "Landing Page",
    body: `Sections: hero headline · subhead · pain/problem · promise/result · what they get · who it's for · how it works · proof · FAQ · CTA · compliance/disclaimer.
Headline formula: "Get [RESULT] Without [PAIN] Using [METHOD]."
Lead-gen fields: name, email, business/project type, main problem (optional phone/budget/timeline). Enterprise qualification: company, role, team size, current tools, lead volume, budget range, decision timeline, primary bottleneck.`,
  },
  email_nurture: {
    title: "Email Nurture (+ CAN-SPAM)",
    body: `7-email sequence: 1) deliver asset 2) educate (real problem) 3) agitate (where results leak) 4) framework 5) proof 6) handle objections 7) offer/booking.
COMPLIANCE (CAN-SPAM): no deceptive headers/subject lines, clearly identify the sender, include a valid physical postal address, and give a working opt-out/unsubscribe in every commercial email.`,
  },
  paid_media: {
    title: "Paid Media (+ incrementality)",
    body: `Funnel: Cold awareness → Lead magnet → Retargeting → Conversion → Reactivation.
Creative by stage: cold = problem/curiosity · lead = checklist/template · retarget = proof/case study · conversion = offer/direct CTA · reactivation = new angle/bonus.
MEASUREMENT: don't scale on platform-reported conversions alone. Hierarchy = platform metrics + CRM data + sales data + holdout/incrementality testing + revenue quality. Incrementality measures what happened BECAUSE of the ads, not just what a dashboard credited.`,
  },
  channels: {
    title: "Channel Role Matrix",
    body: `Give every channel ONE job; don't blindly cross-post.
LinkedIn = B2B authority/founder-led · Instagram = visual education/Reels/brand · TikTok = fast awareness/trend testing · YouTube = searchable authority/demos/long-form trust · Facebook = local/groups/retargeting · X = opinions/thought leadership · Email = nurture/conversion/retention · SMS = reminders/urgent follow-up · Webinars = education + high-ticket · Blog/SEO = search capture/long-term authority · Paid search = high-intent capture · Retargeting = warm conversion.`,
  },
  production: {
    title: "Production Workflow & Team",
    body: `Workflow: Brief → research → angle → copy draft → creative draft → COMPLIANCE REVIEW → approval → schedule → publish → community mgmt → reporting → optimization.
Roles (or hats one operator wears): Strategist · Brand · Content Lead · Copywriter · Designer · Video Editor · Media Buyer · Marketing Ops (CRM/automation/tracking) · Analyst · Community Manager · Sales · Compliance Reviewer · PM.
RACI each task (Responsible/Accountable/Consulted/Informed) so nothing ships unreviewed.`,
  },
  governance: {
    title: "Governance & Compliance",
    body: `Tag every claim: factual · opinion · projection · customer result · comparative · legal/medical/financial.
Review gates: income claim → proof + disclaimer · health → medical/legal review · legal → attorney review · financial → compliance · performance → data source · customer result → permission + context · testimonial/sponsored → FTC disclosure.
FTC: influencers/endorsers must clearly disclose material brand relationships. GDPR: if you collect/process personal data of EU/EEA individuals, GDPR obligations likely apply (lawful basis, consent, data rights, transfers). When in doubt, escalate to legal — do not publish an unverified or non-compliant claim.`,
  },
  qa: {
    title: "QA Checklists",
    body: `POST: one audience · one hook · one pain · one insight · one CTA · no unsupported claim · no misleading promise · no fake urgency · brand voice · CTA link/keyword works · UTM if needed · approved for channel.
LANDING PAGE: clear headline/offer · CTA above fold · mobile works · form works · thank-you page · tracking installed · privacy/disclaimer · acceptable speed · CRM routing.
FUNNEL: post CTA works · DM response works · lead magnet delivers · email triggers · CRM record created · sales notified · booking link works · follow-up task created · reporting source captured.`,
  },
  kpis: {
    title: "KPI Hierarchy & Scorecard",
    body: `Hierarchy: Business (revenue/profit/CAC/LTV) → Sales (calls booked/show/close) → Funnel (leads/conv/opt-in) → Content (saves/shares/comments/CTR) → Paid (CPA/ROAS/CPM/CPC/freq) → Email (open/CTR/reply/unsub) → Ops (assets produced/approvals/turnaround).
Weekly scorecard: posts published, comments, DMs started, leads, calls booked, calls showed, deals closed, revenue, top post, worst post, best hook, best CTA, next test.`,
  },
  experiments: {
    title: "Experimentation",
    body: `Test ONE variable at a time: hook (fear/desire/curiosity) · CTA (comment/DM/link) · lead magnet · creative (text/video/carousel) · audience (broad/niche) · offer (free vs paid audit) · landing (short/long) · follow-up (fast DM vs email).
Template: hypothesis · audience · variable · control · variant · success metric · start/end · result · decision.
Decision logic: Scale = clear improvement · Hold = inconclusive · Kill = worse · Retest = promising but noisy.`,
  },
  rollout: {
    title: "30 / 60 / 90 Rollout",
    body: `Days 1–30 (Foundation): define offer ladder + audience segments + brand voice; build 5 pillars + 3 lead magnets + a landing page; install CRM tracking; launch first ~20 posts; start DM follow-up; build weekly dashboard.
Days 31–60 (Production): 5–7 posts/week; 2 lead-gen campaigns; test 3 hooks + 3 CTAs; launch email nurture; start retargeting; build case studies; weekly optimization meeting.
Days 61–90 (Scale): double down on winners; build paid campaigns; add webinar/workshop; sales enablement; lead scoring; reactivation sequence; referral campaign; monthly insights report.`,
  },
};

/** Resolve a section by key (fuzzy), else the overview + index. Used by the tool. */
export function marketingPlaybook(section?: string): string {
  if (section) {
    const key = section.trim().toLowerCase().replace(/[^a-z]/g, "_");
    const hit = MARKETING_SECTIONS[key] ?? Object.entries(MARKETING_SECTIONS).find(([k]) => key.includes(k) || k.includes(key))?.[1];
    if (hit) return `MARKETING ENGINE — ${hit.title}\n\n${hit.body}`;
    return `Unknown section "${section}". Available: ${Object.keys(MARKETING_SECTIONS).join(", ")}.\n\n${MARKETING_ENGINE}`;
  }
  return MARKETING_ENGINE;
}

/** Concise pointer injected into personas so agents know to apply the engine. */
export const MARKETING_ENGINE_POINTER =
  "MARKETING TASKS: for any post/caption/campaign/'make this go viral'/lead-magnet/funnel request, call the marketing_playbook tool and apply that universal engine (hook→problem→insight→value→CTA→follow-up, one goal, one CTA keyword, platform-tuned). For the enterprise build (campaign brief, funnels, landing pages, email, paid, governance/compliance, KPIs, rollout) call marketing_playbook with a `section`. Research and CITE any factual claim — never fabricate stats, studies, or testimonials. Execute with the real tools: image_generate → instagram_post/composio_action → schedule_task → memory_write.";
