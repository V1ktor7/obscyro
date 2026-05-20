"use client";

import { cn } from "@/lib/cn";
import CopyButton from "./CopyButton";

interface StaticCodeBlockProps {
  html: string;
  rawValue: string;
  language?: string;
  filename?: string;
  className?: string;
  showCopy?: boolean;
  /** Uniform black code surface; token colors stay Shiki defaults (Features section). */
  solidDarkCode?: boolean;
}

export default function StaticCodeBlock({
  html,
  rawValue,
  language,
  filename,
  className,
  showCopy = true,
  solidDarkCode = false,
}: StaticCodeBlockProps) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border-subtle bg-code-bg shadow-code",
        solidDarkCode && "static-code-solid-dark",
        className,
      )}
    >
      {filename ? (
        <div className="flex items-center justify-between border-b border-white/[0.06] bg-black/40 px-4 py-2 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-fg-secondary">
          <span>{filename}</span>
          {language ? (
            <span className="text-[0.6rem] text-fg-secondary/70">{language}</span>
          ) : null}
        </div>
      ) : null}
      <div
        className="thin-scrollbar overflow-x-auto px-1 py-4 font-mono text-[0.825rem] leading-relaxed text-code-fg [&_pre]:bg-transparent [&_pre]:p-0 [&_pre]:px-4"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {showCopy ? (
        <CopyButton
          value={rawValue}
          className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100"
        />
      ) : null}
    </div>
  );
}
