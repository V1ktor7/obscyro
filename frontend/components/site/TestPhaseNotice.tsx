"use client";

import { AlertTriangle } from "lucide-react";

import { useT } from "@/lib/i18n/context";
import {
  UNSTABLE_API_ENDPOINTS,
  formatUnstableEndpoint,
} from "@/lib/unstable-endpoints";
import { cn } from "@/lib/cn";

type TestPhaseNoticeProps = {
  /** Wider padding and default borders for in-app panels */
  variant?: "banner" | "panel";
  className?: string;
};

export default function TestPhaseNotice({
  variant = "panel",
  className,
}: TestPhaseNoticeProps) {
  const t = useT();
  const isBanner = variant === "banner";

  return (
    <aside
      className={cn(
        "border border-amber-500/30 bg-amber-500/10 text-fg-primary",
        isBanner ? "rounded-none border-0 bg-transparent" : "rounded-lg p-4",
        className,
      )}
    >
      <div
        className={cn(
          "flex gap-3",
          isBanner ? "items-start px-3 py-2 sm:px-4 sm:py-2.5" : "items-start",
        )}
      >
        <AlertTriangle
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0 text-amber-700",
            isBanner && "max-[380px]:hidden",
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1 space-y-2 text-left">
          <p className="font-mono text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-amber-800">
            {t("beta.label")}
          </p>
          <p className={cn("text-sm text-fg-primary", isBanner && "max-sm:text-xs")}>
            {t("beta.message")}
          </p>
          <details className="group rounded-md border border-amber-500/20 bg-bg-primary/40">
            <summary className="cursor-pointer list-none px-2 py-1.5 font-mono text-[0.65rem] uppercase tracking-[0.18em] text-fg-secondary outline-none ring-focus [&::-webkit-details-marker]:hidden">
              <span className="select-none underline underline-offset-2 group-open:no-underline">
                {t("beta.unstableApisDetails")}
              </span>
              <span className="ml-1 text-amber-700/80 group-open:rotate-90" aria-hidden>
                ›
              </span>
            </summary>
            <div className="border-t border-amber-500/15 px-2 py-2">
              <p className="mb-1.5 text-xs text-fg-secondary">{t("beta.unstableApisIntro")}</p>
              <ul className="max-h-[40vh] space-y-0.5 overflow-y-auto thin-scrollbar font-mono text-[0.65rem] leading-relaxed text-fg-primary sm:max-h-none">
                {UNSTABLE_API_ENDPOINTS.map((e) => (
                  <li key={`${e.method}-${e.path}`} className="break-all pl-1">
                    {formatUnstableEndpoint(e)}
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </div>
      </div>
    </aside>
  );
}
