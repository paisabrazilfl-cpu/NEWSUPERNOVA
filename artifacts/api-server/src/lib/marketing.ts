/**
 * The Marketing Engine — a universal, plug-and-play content + conversion playbook
 * the swarm applies to ANY marketing task (any niche, any offer, any platform).
 *
 * Surfaced to agents via the `marketing_playbook` tool and referenced in the
 * social persona, so "write a post / caption / campaign / make this go viral"
 * always runs through the same proven machine — and through this system's REAL
 * capabilities (research → write → image_generate → instagram_post → schedule →
 * track), not generic advice.
 *
 * Built on the operator's universal framework and hardened with: accuracy-first
 * guardrails, named psychology triggers, platform adaptation, algorithm
 * mechanics, and an execution loop tied to the swarm's tools.
 */
export const MARKETING_ENGINE = `
MARKETING ENGINE — universal plug-and-play post → conversion machine (any niche/offer/platform).

THE CHAIN (most chase only attention; the money is the full chain):
Attention → Trust → Desire → Action → Follow-up → Conversion.
Core truth: VIEWS ARE NOT THE BUSINESS. CONVERSATIONS ARE. Optimize for qualified conversations, not likes.

ACCURACY FIRST (non-negotiable — overrides "make it punchy"):
- Every factual claim, statistic, study, or result in a post MUST be TRUE and verifiable. RESEARCH it first (web_search / tier1_sources) and keep the source. Punchy ≠ fabricated.
- NEVER invent stats ("boosts output 300%"), studies ("MIT & Stanford research"), testimonials, or results. A vague "recent studies show" with no real source is a fabrication — cut it or replace it with a real, cited fact.
- Hooks may be bold and emotional, but the underlying claim must hold up. Curiosity and FOMO are fine; lying is not.
- Disclose paid/affiliate/ad relationships (FTC) and respect each platform's ToS. No fake scarcity, no deceptive claims.

THE UNIVERSAL POST FORMULA (6 beats):
Hook → Problem → Insight → Value → CTA → Follow-up system.
[HOOK] Most people think [COMMON BELIEF].
[PROBLEM] But the real issue is [HIDDEN PROBLEM] — costing [PAIN].
[INSIGHT] The ones winning do [BETTER METHOD].
[VALUE] Here are [3–7] things you can use now: 1) … 2) … 3) …
[CTA] Comment [KEYWORD] and I'll send you [RESOURCE].
[FOLLOW-UP] (keyword → DM → qualify → offer → follow up).

HOOKS (line 1 must earn line 2; front-load the payoff "above the fold"). Proven angles:
- Curiosity gap: "Nobody in [niche] is talking about this…"
- Contrarian / pattern interrupt: "Unpopular opinion: more [obvious thing] won't fix it."
- Specificity: "I cut [metric] by [exact number] in [timeframe] with one change." (only if TRUE)
- Loss/cost framing: "You're quietly losing [X] because of [Y]."
- Desired-outcome: "Here's how to get [result] without [pain]."
- Identity: "If you're a [audience] who [trait], read this."
Test 3 hook angles per idea: FEAR vs DESIRE vs CURIOSITY. Keep the one that earns saves/comments/DMs.

PSYCHOLOGY TRIGGERS (use truthfully; name the lever you're pulling):
Curiosity gap (open loop you close in the post) · Specificity/concreteness (real numbers beat vague) · Social proof (real results/quotes) · Loss aversion & FOMO (real stakes) · Authority (real credentials/sources) · Reciprocity (give value free first) · Identity/belonging ("for people who…") · Pattern interrupt (break the scroll).

POST GOAL — pick ONE per post (don't make every post sell; rotate):
Attention → curiosity/contrarian → comment keyword | Trust → education/breakdown → "save this" | Leads → checklist/template → comment keyword | Sell → offer post → DM / book call | Retarget → case study/proof → apply/book.

CONTENT PILLARS (any niche): Problem · Mistakes · Framework · Proof · Tools/Templates · Contrarian · Offer.

POST TYPES (templates): Curiosity · Problem-Agitate-Solution · Mistakes (N mistakes) · Before/After · Checklist · Contrarian · Direct Offer. Match the type to the chosen goal.

CTA LADDER (match to intent): Soft ("save this") · Engagement ("comment YES") · Lead ("comment GUIDE") · DM ("DM me AUDIT") · Sales ("book a call") · Retarget ("ready? message me").
Keyword bank: GUIDE · CHECKLIST · MAP · AUDIT · TEMPLATE · PLAN · SYSTEM · FIX · START · SCALE.

PLATFORM ADAPTATION (same machine, tuned):
- Instagram: hook in line 1 (it's all that shows before "more"); tight paragraphs + emoji rhythm; 8–15 mixed-reach hashtags (few huge, several mid, a few niche); image/carousel/Reel that stops the scroll. Engagement signals that matter: SAVES + SHARES + comments + dwell. Put the CTA keyword clearly; pin a first comment.
- LinkedIn: longer text OK, story + insight, NO hashtag spam (3–5), reward dwell time; CTA = comment/DM, soft.
- X/Threads: brevity, strong first line, 1 idea; thread for depth.
- TikTok/Reels/Shorts: first 2 seconds = hook on screen + spoken; optimize watch-time & loops; trend-aware.

THE FUNNEL: Post → comment/DM keyword → send resource → ask ONE qualifying question → identify pain → offer next step → book/sell/send link → follow up.
DM flow (generic, human, not pushy): 1) "Here's the [resource]. Quick Q — what are you working on right now?" 2) "Got it. What's the biggest thing you're trying to fix?" 3) "Makes sense — the main bottleneck is probably [X]; next step is [Y]." 4) "Want me to send the next step?" → booking/product/application link.

OFFER LADDER (every post points to one rung): Free value (checklist/guide/audit) → Low-ticket (mini course/template pack) → Core (service/product) → Premium (done-for-you) → Recurring (retainer/subscription).
LEAD MAGNETS: checklist · beginner guide · advanced playbook · mistake list · calculator/scorecard · template · case-study breakdown · buyer's guide · roadmap. Default winner: "The [Niche] Improvement Checklist: the 5 biggest bottlenecks holding back your results."

WEEKLY CALENDAR (mix, don't only sell): Mon problem · Tue education · Wed checklist/template (leads) · Thu contrarian (authority) · Fri proof/case study · Sat direct offer · Sun story/recap. Target mix: 2 education, 2 lead-gen, 1 proof, 1 offer, 1 personal.

KPIs (track weekly; conversations > likes): impressions (hook?) · saves (value?) · comments (CTA?) · DMs (intent?) · link clicks · leads · calls booked · sales · follow-up replies. Test ONE variable at a time (hook OR CTA OR offer).

HOW THIS SWARM RUNS THE ENGINE (use the real tools, end to end):
1) Pick ONE audience + ONE pain + ONE desired result + ONE offer-ladder rung.
2) RESEARCH the angle and any claim (web_search / tier1_sources) — get a real, citable fact. No claim ships unverified.
3) WRITE the post with the formula + a tested hook + ONE goal + ONE CTA keyword.
4) image_generate a scroll-stopping on-brand visual (it returns an absolute public URL).
5) PUBLISH: instagram_post(image_url, caption) for IG; composio_action for other connected apps. Post once.
6) SCHEDULE the calendar with schedule_task (recurring cron) so the engine runs itself.
7) TRACK what worked with memory_write (hook angle, CTA, saves/DMs) and feed it back into the next round.

POSITIONING LINE (fill in): "I help [AUDIENCE] get [RESULT] without [PAIN] using [METHOD]."

MASTER TEMPLATE (any niche):
"Most people in [NICHE] think [COMMON BELIEF]. But that's why they struggle with [PROBLEM]. The real issue is [ROOT CAUSE]. The ones getting [DESIRED RESULT] do this instead: 1) … 2) … 3) … 4) … 5) … I made a [RESOURCE] that breaks it down — comment [KEYWORD] and I'll send it."

ONE-SENTENCE ENGINE: Expose a real painful problem, teach a true better way, offer a useful resource, start a conversation, qualify the lead, move them to the next step — and track conversations, not likes.`;

/** Concise pointer injected into personas so agents know to apply the engine. */
export const MARKETING_ENGINE_POINTER =
  "MARKETING TASKS: for any post/caption/campaign/'make this go viral' request, call the marketing_playbook tool and apply that universal engine (hook→problem→insight→value→CTA→follow-up, one goal, one CTA keyword, platform-tuned). Research and CITE any factual claim — never fabricate stats, studies, or testimonials. Then execute with the real tools: image_generate → instagram_post/composio_action → schedule_task → memory_write.";
