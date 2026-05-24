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
        "group relative min-w-0 overflow-hidden rounded-xl border border-border-subtle bg-code-bg shadow-code",
        solidDarkCode && "static-code-solid-dark",
        className,
      )}
    >
      {filename ? (
        <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] bg-black/40 px-3 py-2 font-mono text-[0.6rem] uppercase tracking-[0.18em] text-fg-secondary sm:px-4 sm:text-[0.65rem] sm:tracking-[0.2em]">
          <span className="truncate">{filename}</span>
          {language ? (
            <span className="shrink-0 text-[0.55rem] text-fg-secondary/70 sm:text-[0.6rem]">
              {language}
            </span>
          ) : null}
        </div>
      ) : null}
      <div
        className="thin-scrollbar overflow-x-auto px-1 py-3 font-mono text-[0.75rem] leading-relaxed text-code-fg sm:py-4 sm:text-[0.825rem] [&_pre]:bg-transparent [&_pre]:p-0 [&_pre]:px-3 sm:[&_pre]:px-4"
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
