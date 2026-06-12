import { useState } from "react";
import {
  Sparkles, X, Image as ImageIcon, FileDown, Paperclip, Mic, Copy, Compass,
  BookOpen, ShieldCheck, MessagesSquare, Wrench, RotateCcw, Link2, Gauge,
  LayoutTemplate, Globe, KeyRound, Scale, BadgeCheck, Cpu,
  Lock, Phone, MousePointerClick, ShieldAlert, Target,
} from "lucide-react";

/**
 * What's New / Capabilities panel. Every item here maps to a feature or fix that
 * actually shipped — no aspirational claims. Surfaced from the chat header so the
 * operator can see what the system can really do now.
 */

interface Item {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}

const CAPABILITIES: Item[] = [
  { icon: Lock, title: "Operator sign-in — the whole console is private", body: "The dashboard now requires an operator password, and every data/action API is closed to anyone else. Sign in once and your session covers everything; sign out from Settings. The external API stays protected by its own key." },
  { icon: Phone, title: "Run the swarm by phone (voice)", body: "Call a number and talk to ABBY: ask questions, dispatch a real orchestrated task, hear the result read back. Powered by a Vapi voice assistant wired to the swarm — the work runs even after you hang up." },
  { icon: MousePointerClick, title: "Operates your accounts — API first, browser as fallback", body: "Connect Gmail and any Composio app via OAuth and the swarm acts for you (send mail, post, manage SaaS). For a site with no API, browser_login drives a Steel browser that signs in with credentials you store in the vault and does the task. Prefers the API; uses the browser only when needed." },
  { icon: ShieldAlert, title: "Hard safety limits on account actions", body: "Enforced in code, never overridable: the swarm will NOT open financial accounts (bank, brokerage, credit, loan, crypto) or submit government IDs (SSN, passport, license, tax ID). Everything else runs end to end." },
  { icon: Target, title: "Solves your request, then verifies it", body: "After the CLAWs report, ABBY re-checks the answer against your goal and keeps correcting — within a bounded budget — until it actually solves it, instead of handing back a half-answer. If it can't fully solve it, it says so honestly." },
  { icon: Cpu, title: "NVIDIA NIM model engine", body: "The swarm now runs on NVIDIA-hosted models — ABBY on Nemotron 3 Ultra 550B (1M context, agentic reasoning), the CLAWs on Nemotron Super, DeepSeek V4 Flash, and Qwen 3.5 MoE — each live-verified for chat, tool calling, and JSON mode. If the NVIDIA key is missing, every agent transparently falls back to its previous model, so nothing ever goes dark." },
  { icon: LayoutTemplate, title: "$0 on-brand image cards", body: "Quotes, hooks, news, and stat posts render as real 1080×1080 PNGs by code — terminal/cyber on-brand, at about $0 each. The swarm reaches for these before paid image generation, paying only when you genuinely need a photoreal picture." },
  { icon: Globe, title: "ASCII world stories", body: "Generate a stylized ASCII \"world\" story or triptych as a real, shareable image — a distinct on-brand visual format alongside the cards." },
  { icon: KeyRound, title: "Uses your saved API keys automatically", body: "The swarm reads the credentials in Settings → Stored Secrets and authenticates with them at call time (write-only — never shown to the model). Tasks needing Render, GitHub, and other APIs just work instead of reporting \"not connected.\"" },
  { icon: ImageIcon, title: "Image generation", body: "Ask for any image, logo, or illustration and get a real, downloadable PNG — not a description. Even verb-less prompts like \"ultra realistic image of a dog\" work." },
  { icon: FileDown, title: "Downloadable files", body: "PDFs, CSVs, decks, and documents are genuinely created and given a download link — never hallucinated." },
  { icon: Paperclip, title: "File & image upload", body: "Attach files or images in chat; ABBY reads them with vision + OCR and works from their contents." },
  { icon: Mic, title: "Voice in & out", body: "Talk to the swarm (speech-to-text) and have replies read back aloud (text-to-speech)." },
  { icon: Copy, title: "Copy + full markdown", body: "Copy any message with one tap. Replies render full markdown — tables, headings, code blocks, lists." },
  { icon: Compass, title: "Dispatch panel", body: "See which CLAW and which model handled each directive, with a grounding proof that your source material reached it." },
  { icon: Link2, title: "Acts on your connected accounts", body: "ABBY knows which tools, APIs, and integrations are live and acts on your connected accounts — \"check my Instagram\", \"any new emails?\", \"post to my LinkedIn\" — instead of refusing. If an app isn't connected, it tells you to add it in Settings → Connect Apps." },
  { icon: BookOpen, title: "Research playbooks", body: "VPD (Vehicles Per Day + Value Proposition Design), market research (TAM/SAM/SOM), a full deck builder, and a PhD-level library across business, engineering, coding, AI, SEO/AEO, marketing, money, and geofencing." },
  { icon: MessagesSquare, title: "Marketing engine", body: "A universal plug-and-play playbook for any niche: hook → problem → insight → value → CTA → follow-up, platform-tuned, accuracy-first (every claim researched & cited — no fabricated stats). The swarm runs it end to end: research → write → generate image → post → schedule → track." },
  { icon: ShieldCheck, title: "Tier-1 source library", body: "Answers are grounded in a whitelist of authoritative sources, with evidence labeling." },
  { icon: MessagesSquare, title: "Export conversation", body: "Download any chat as .txt or .json from the header." },
];

const FIXES: Item[] = [
  { icon: BadgeCheck, title: "No fabricated success or padded data", body: "Agents report only what they actually ran and verified — no fake \"deployed,\" no placeholder rows padded to hit a target count, no empty/None results dressed up as success." },
  { icon: KeyRound, title: "A working key is never called \"not connected\"", body: "Authenticated API calls auto-attach your stored token, and a 401 from a missing auth header is caught and retried — instead of being mis-reported as an invalid or expired key." },
  { icon: Scale, title: "Conflicting agent results resolved by evidence", body: "When two CLAWs disagree, ABBY trusts the one with concrete proof — a real deploy id beats an unauthenticated 401 — and gives one clear answer instead of echoing both." },
  { icon: ImageIcon, title: "No more \"I can't generate images\"", body: "Image requests now route to the real image tool every time, instead of being refused inline." },
  { icon: Wrench, title: "Big generations don't fail anymore", body: "Large code and deck outputs no longer break on truncated tool-call arguments — the agent retries smaller and recovers, and big files (e.g. a PDF) save in chunks instead of failing." },
  { icon: RotateCcw, title: "No more spinning on the same call", body: "If an agent repeats an identical tool call or makes no progress for a few steps, the loop stops and it concludes honestly with what it has — no more burning the whole budget on a stuck call, and no invented download links." },
  { icon: RotateCcw, title: "Interrupted ≠ failed", body: "A deploy or restart now shows as amber \"interrupted,\" not a red CLAW \"failure,\" so the failure count reflects real failures only." },
  { icon: Link2, title: "Source material actually reaches the CLAWs", body: "What you paste or upload is grounded into each directive, so agents work from your data instead of guessing." },
  { icon: MessagesSquare, title: "Answers, not internal state", body: "Agents stopped dumping raw self-audit / navel-gazing logs and now return the actual result." },
  { icon: Gauge, title: "No more stale-build ghosts", body: "Cache headers were fixed so a normal reload always lands the newest deployed build." },
];

function Section({ heading, items }: { heading: string; items: Item[] }) {
  return (
    <div>
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-2">{heading}</h3>
      <div className="space-y-2">
        {items.map((it) => (
          <div key={it.title} className="flex gap-3 rounded-lg border border-card-border bg-card/50 p-3">
            <it.icon className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">{it.title}</div>
              <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{it.body}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WhatsNewButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="What's new"
        data-testid="whats-new-button"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-card-border/50 transition-colors"
      >
        <Sparkles className="w-4 h-4" /> <span className="hidden sm:inline">What's new</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative z-10 w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border border-card-border bg-popover shadow-2xl">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-card-border shrink-0">
              <Sparkles className="w-5 h-5 text-primary" />
              <h2 className="text-base font-bold tracking-tight text-foreground flex-1">What's new in OpenClaw</h2>
              <button onClick={() => setOpen(false)} aria-label="Close" className="p-1.5 -mr-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-card-border/50">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto px-5 py-4 space-y-5">
              <Section heading="What you can do now" items={CAPABILITIES} />
              <Section heading="Reliability fixes" items={FIXES} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
