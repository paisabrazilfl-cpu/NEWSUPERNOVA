import { useState, type ReactNode } from "react";
import { Copy, Check } from "lucide-react";

/**
 * Dependency-free message renderer. We intentionally avoid pulling in a markdown
 * library (supply-chain + bundle cost); this handles the cases that actually
 * matter for chat: fenced code blocks (```), inline `code`, and safe wrapping of
 * everything else. Plain text is rendered with preserved whitespace.
 */

type Segment =
  | { type: "code"; lang: string; text: string }
  | { type: "text"; text: string };

function parse(content: string): Segment[] {
  const segments: Segment[] = [];
  const fence = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(content)) !== null) {
    if (m.index > last) segments.push({ type: "text", text: content.slice(last, m.index) });
    segments.push({ type: "code", lang: m[1] || "", text: m[2].replace(/\n$/, "") });
    last = fence.lastIndex;
  }
  if (last < content.length) segments.push({ type: "text", text: content.slice(last) });
  return segments.length ? segments : [{ type: "text", text: content }];
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="my-2 rounded-lg border border-card-border bg-background/70 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-card-border bg-card/40">
        <span className="text-[11px] font-mono text-muted-foreground">{lang || "code"}</span>
        <button
          onClick={copy}
          aria-label="Copy code"
          className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 text-[11px]"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-[13px] leading-relaxed font-mono">
        <code>{text}</code>
      </pre>
    </div>
  );
}

/** Render inline `code` spans within a text run. */
function inlineCode(text: string, keyBase: string) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("`") && p.endsWith("`") && p.length > 1) {
      return (
        <code key={`${keyBase}-${i}`} className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono text-[0.85em]">
          {p.slice(1, -1)}
        </code>
      );
    }
    return <span key={`${keyBase}-${i}`}>{p}</span>;
  });
}

/**
 * Render a text run, turning markdown images ![alt](url) into actual <img>
 * elements (used to show uploaded pictures inline) and leaving the rest to the
 * inline-code renderer.
 */
function renderRun(text: string, keyBase: string) {
  const img = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = img.exec(text)) !== null) {
    if (m.index > last) out.push(...inlineCode(text.slice(last, m.index), `${keyBase}-t${n}`));
    out.push(
      <img
        key={`${keyBase}-img${n}`}
        src={m[2]}
        alt={m[1] || "attachment"}
        className="my-2 max-h-80 max-w-full rounded-lg border border-card-border object-contain"
        loading="lazy"
      />,
    );
    last = img.lastIndex;
    n++;
  }
  if (last < text.length) out.push(...inlineCode(text.slice(last), `${keyBase}-t${n}`));
  return out;
}

export function MessageContent({ content }: { content: string }) {
  const segments = parse(content);
  return (
    <div className="text-[15px] leading-relaxed">
      {segments.map((seg, i) =>
        seg.type === "code" ? (
          <CodeBlock key={i} lang={seg.lang} text={seg.text} />
        ) : (
          <span key={i} className="whitespace-pre-wrap break-words">
            {renderRun(seg.text, String(i))}
          </span>
        ),
      )}
    </div>
  );
}
