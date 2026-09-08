"use client";

import { Fragment } from "react";

const TOKEN = /(@\[[^\]]+\]|https?:\/\/[^\s<]+|\*\*[^*]+\*\*|_[^_]+_)/g;

/** Renders comment text: @[Name] mentions, links, **bold**, _italic_, line breaks. */
export function CommentBody({ text, me, className }: { text: string; me?: string; className?: string }) {
  const lines = text.split("\n");
  return (
    <div className={className}>
      {lines.map((line, li) => (
        <Fragment key={li}>
          {li > 0 && <br />}
          {line.split(TOKEN).map((part, i) => {
            if (!part) return null;
            if (part.startsWith("@[") && part.endsWith("]")) {
              const name = part.slice(2, -1);
              const isMe = me && name === me;
              return (
                <span
                  key={i}
                  className={isMe ? "rounded bg-red-soft px-1 font-medium text-red-ink" : "rounded bg-blue-soft px-1 font-medium text-blue"}
                >
                  @{name}
                </span>
              );
            }
            if (/^https?:\/\//.test(part)) {
              return (
                <a key={i} href={part} target="_blank" rel="noreferrer" className="text-blue underline decoration-blue/40 underline-offset-2 break-all">
                  {part.replace(/^https?:\/\//, "").slice(0, 60)}
                  {part.length > 68 ? "…" : ""}
                </a>
              );
            }
            if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
            if (part.startsWith("_") && part.endsWith("_") && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
            return <Fragment key={i}>{part}</Fragment>;
          })}
        </Fragment>
      ))}
    </div>
  );
}

export function plainText(text: string): string {
  return text.replace(/@\[([^\]]+)\]/g, "@$1");
}

export function mentionsIn(text: string): string[] {
  return Array.from(text.matchAll(/@\[([^\]]+)\]/g)).map((m) => m[1]);
}
