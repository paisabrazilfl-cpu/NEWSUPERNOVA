import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { resolveApiUrl } from "@workspace/api-client-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Full markdown renderer for chat (GitHub-flavored): headings, bold/italic,
 * lists, blockquotes, tables, links, images, and fenced code with a copy button.
 * Links to /api/uploads render as download chips so generated artifacts are
 * one-click downloadable.
 */

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

// Same-origin in prod; in dev the API lives elsewhere, so route /api links through resolveApiUrl.
function resolveHref(href: string): string {
  return href.startsWith("/api/") ? resolveApiUrl(href) : href;
}

const components: Components = {
  h1: ({ children }) => <h1 className="text-xl font-bold mt-3 mb-1.5 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-lg font-bold mt-3 mb-1.5 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-base font-semibold mt-2.5 mb-1 first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="my-1.5 leading-relaxed break-words first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="list-disc pl-5 my-1.5 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 my-1.5 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-[#00e5ff]/50 pl-3 my-2 text-muted-foreground italic">{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-card-border" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-card-border">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-card/60">{children}</thead>,
  th: ({ children }) => <th className="border border-card-border px-2.5 py-1.5 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border border-card-border px-2.5 py-1.5 align-top">{children}</td>,
  a: ({ href, children }) => {
    const raw = href ?? "";
    const isDownload = /[?&]download=1/.test(raw) || /\/api\/uploads\//.test(raw);
    return (
      <a
        href={resolveHref(raw)}
        target="_blank"
        rel="noopener noreferrer"
        {...(isDownload ? { download: "" } : {})}
        className={
          isDownload
            ? "inline-flex items-center gap-1.5 my-1 rounded-md border border-[#00e5ff]/50 bg-[#00e5ff]/10 px-2.5 py-1 text-sm font-medium text-[#00e5ff] hover:bg-[#00e5ff]/20 transition-colors no-underline"
            : "text-[#00e5ff] underline underline-offset-2 hover:text-[#00e5ff]/80 break-words"
        }
      >
        {isDownload ? <>⬇ {children}</> : children}
      </a>
    );
  },
  img: ({ src, alt }) => (
    <img
      src={typeof src === "string" ? resolveHref(src) : src}
      alt={alt || "attachment"}
      className="my-2 max-h-80 max-w-full rounded-lg border border-card-border object-contain"
      loading="lazy"
    />
  ),
  code: ({ className, children }) => {
    const text = String(children ?? "").replace(/\n$/, "");
    const match = /language-(\w+)/.exec(className || "");
    // Block code: has a language class or spans multiple lines.
    if (match || text.includes("\n")) {
      return <CodeBlock lang={match?.[1] ?? ""} text={text} />;
    }
    return <code className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono text-[0.85em]">{children}</code>;
  },
  // `pre` would otherwise wrap our CodeBlock in an extra <pre>; render children directly.
  pre: ({ children }) => <>{children}</>,
};

export function MessageContent({ content }: { content: string }) {
  return (
    <div className="text-[15px] leading-relaxed [&>:first-child]:mt-0 [&>:last-child]:mb-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
