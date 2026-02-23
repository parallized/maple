import type { ReactNode } from "react";
import { MapleAssetImage } from "./maple-asset-image";
import { parseMapleAssetUrl } from "./maple-assets";

type MarkdownListItem = {
  text: string;
  checked: boolean | null;
};

type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: MarkdownListItem[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "code"; language: string; code: string }
  | { kind: "image"; alt: string; src: string };

function parseImageLine(line: string): { alt: string; src: string } | null {
  const match = line.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/);
  if (!match) return null;
  return {
    alt: match[1] ?? "",
    src: match[2] ?? ""
  };
}

function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const rawLine = lines[index] ?? "";
    const line = rawLine.trimEnd();

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const codeFence = line.match(/^```([\w-]*)\s*$/);
    if (codeFence) {
      const language = codeFence[1] ?? "";
      index += 1;
      const codeLines: string[] = [];
      while (index < lines.length) {
        const candidate = (lines[index] ?? "").trimEnd();
        if (/^```/.test(candidate)) break;
        codeLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ kind: "code", language, code: codeLines.join("\n") });
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({ kind: "heading", level: headingMatch[1]!.length, text: headingMatch[2]!.trim() });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const current = (lines[index] ?? "").trimEnd();
        if (!/^>\s?/.test(current)) break;
        quoteLines.push(current.replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ kind: "quote", lines: quoteLines });
      continue;
    }

    const image = parseImageLine(line.trim());
    if (image) {
      blocks.push({ kind: "image", alt: image.alt, src: image.src });
      index += 1;
      continue;
    }

    const unorderedMatch = line.match(/^[-*+]\s+(.+)$/);
    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (unorderedMatch || orderedMatch) {
      const ordered = Boolean(orderedMatch);
      const matcher = ordered ? /^\d+\.\s+(.+)$/ : /^[-*+]\s+(.+)$/;
      const items: MarkdownListItem[] = [];
      while (index < lines.length) {
        const current = (lines[index] ?? "").trimEnd();
        const itemMatch = current.match(matcher);
        if (!itemMatch) break;
        const content = (itemMatch[1] ?? "").trim();
        if (!ordered) {
          const taskMatch = content.match(/^\[( |x|X)\]\s+(.+)$/);
          if (taskMatch) {
            items.push({
              checked: taskMatch[1]?.toLowerCase() === "x",
              text: taskMatch[2] ?? ""
            });
            index += 1;
            continue;
          }
        }
        items.push({ checked: null, text: content });
        index += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = (lines[index] ?? "").trimEnd();
      if (!current.trim()) break;
      if (
        /^```/.test(current)
        || /^(#{1,6})\s+/.test(current)
        || /^>\s?/.test(current)
        || /^[-*+]\s+/.test(current)
        || /^\d+\.\s+/.test(current)
        || parseImageLine(current.trim()) !== null
      ) {
        break;
      }
      paragraphLines.push(current);
      index += 1;
    }
    if (paragraphLines.length > 0) {
      blocks.push({ kind: "paragraph", lines: paragraphLines });
      continue;
    }

    index += 1;
  }

  return blocks;
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*|\[[^\]]+\]\([^)]+\))/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const token = match[0] ?? "";
    const start = match.index ?? 0;
    if (start > cursor) {
      nodes.push(<span key={`plain-${matchIndex}`}>{text.slice(cursor, start)}</span>);
      matchIndex += 1;
    }

    if (token.startsWith("`")) {
      nodes.push(
        <code key={`code-${matchIndex}`} className="px-1 py-0.5 rounded bg-(--color-base-200) text-[0.92em] font-mono">
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={`strong-${matchIndex}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("~~")) {
      nodes.push(<s key={`strike-${matchIndex}`}>{token.slice(2, -2)}</s>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={`em-${matchIndex}`}>{token.slice(1, -1)}</em>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        const href = link[2] ?? "";
        nodes.push(
          isSafeUrl(href)
            ? (
              <a
                key={`link-${matchIndex}`}
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary underline underline-offset-2"
              >
                {link[1]}
              </a>
            )
            : <span key={`link-plain-${matchIndex}`}>{link[1]}</span>
        );
      } else {
        nodes.push(<span key={`token-${matchIndex}`}>{token}</span>);
      }
    }
    cursor = start + token.length;
    matchIndex += 1;
  }

  if (cursor < text.length) {
    nodes.push(<span key={`tail-${matchIndex}`}>{text.slice(cursor)}</span>);
  }
  return nodes;
}

export function renderTaskMarkdown(markdown: string, emptyText = "无"): ReactNode {
  const blocks = parseMarkdownBlocks(markdown);
  if (blocks.length === 0) return <span className="text-muted">{emptyText}</span>;

  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, blockIndex) => {
        if (block.kind === "heading") {
          const headingClass = block.level <= 2 ? "text-[16px] font-semibold" : "text-[14px] font-semibold";
          return (
            <h4 key={`h-${blockIndex}`} className={`m-0 ${headingClass}`}>
              {renderInlineMarkdown(block.text)}
            </h4>
          );
        }

        if (block.kind === "list") {
          const hasChecklist = !block.ordered && block.items.some((item) => item.checked !== null);
          if (hasChecklist) {
            return (
              <ul key={`checklist-${blockIndex}`} className="list-none pl-0 space-y-1.5">
                {block.items.map((item, itemIndex) => (
                  <li key={`${blockIndex}-${itemIndex}`} className="flex items-start gap-2">
                    {item.checked === null ? (
                      <span className="mt-[0.55rem] h-1.5 w-1.5 rounded-full bg-(--color-secondary)/60 shrink-0" />
                    ) : (
                      <input
                        type="checkbox"
                        checked={item.checked}
                        readOnly
                        aria-hidden="true"
                        className="mt-[0.2rem] h-3.5 w-3.5 shrink-0 accent-(--color-primary) pointer-events-none"
                      />
                    )}
                    <span className={item.checked ? "opacity-65 line-through" : ""}>
                      {renderInlineMarkdown(item.text)}
                    </span>
                  </li>
                ))}
              </ul>
            );
          }

          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag key={`list-${blockIndex}`} className={`${block.ordered ? "list-decimal" : "list-disc"} pl-5 space-y-1`}>
              {block.items.map((item, itemIndex) => (
                <li key={`${blockIndex}-${itemIndex}`}>{renderInlineMarkdown(item.text)}</li>
              ))}
            </ListTag>
          );
        }

        if (block.kind === "quote") {
          return (
            <blockquote
              key={`quote-${blockIndex}`}
              className="m-0 pl-3 border-l-2 border-(--color-base-300) text-secondary/90"
            >
              {block.lines.map((line, lineIndex) => (
                <p key={`${blockIndex}-${lineIndex}`} className="m-0">
                  {renderInlineMarkdown(line)}
                </p>
              ))}
            </blockquote>
          );
        }

        if (block.kind === "code") {
          return (
            <pre
              key={`code-${blockIndex}`}
              className="m-0 p-3 rounded-lg bg-(--color-base-200) border border-(--color-base-300) overflow-x-auto"
            >
              <code className="font-mono text-[12px] leading-[1.6] whitespace-pre">
                {block.code}
              </code>
            </pre>
          );
        }

        if (block.kind === "image") {
          if (parseMapleAssetUrl(block.src)) {
            return (
              <MapleAssetImage
                key={`asset-image-${blockIndex}`}
                assetUrl={block.src}
                alt={block.alt}
              />
            );
          }

          return isSafeUrl(block.src) ? (
            <figure
              key={`image-${blockIndex}`}
              className="m-0 flex flex-col gap-2 rounded-lg border border-(--color-base-300) bg-(--color-base-200)/35 p-2"
            >
              <img
                src={block.src}
                alt={block.alt || "markdown-image"}
                loading="lazy"
                className="w-full h-auto max-h-[320px] object-contain rounded-md"
                referrerPolicy="no-referrer"
              />
              {block.alt ? <figcaption className="text-[12px] text-muted">{block.alt}</figcaption> : null}
            </figure>
          ) : (
            <p key={`image-text-${blockIndex}`} className="m-0 text-muted text-[13px]">
              {block.alt || block.src}
            </p>
          );
        }

        return (
          <p key={`p-${blockIndex}`} className="m-0 whitespace-pre-wrap">
            {block.lines.map((line, lineIndex) => (
              <span key={`${blockIndex}-${lineIndex}`}>
                {renderInlineMarkdown(line)}
                {lineIndex < block.lines.length - 1 ? <br /> : null}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
