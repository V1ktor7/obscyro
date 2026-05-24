"use client";

import {
  Children,
  isValidElement,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

interface TabProps {
  label: string;
  children: ReactNode;
}

function Tab(props: TabProps): null {
  void props;
  return null;
}

interface CodeTabsProps {
  children: ReactNode;
  className?: string;
}

function CodeTabs({ children, className }: CodeTabsProps) {
  const tabs = Children.toArray(children).filter(
    (child): child is ReactElement<TabProps> =>
      isValidElement(child) && typeof (child.props as TabProps).label === "string",
  );
  const [active, setActive] = useState(0);
  if (tabs.length === 0) return null;
  return (
    <div className={cn("not-prose my-6 overflow-hidden rounded-xl border border-border-subtle bg-code-bg shadow-code", className)}>
      <div
        className="thin-scrollbar flex items-center gap-0.5 overflow-x-auto border-b border-white/[0.06] bg-black/40 px-2"
        role="tablist"
      >
        {tabs.map((tab, i) => (
          <button
            key={tab.props.label}
            type="button"
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={cn(
              "relative shrink-0 whitespace-nowrap px-3 py-2.5 font-mono text-[0.65rem] uppercase tracking-[0.15em] transition-colors sm:text-[0.7rem]",
              i === active ? "text-white" : "text-fg-secondary hover:text-white/80",
            )}
          >
            {tab.props.label}
            {i === active ? (
              <span className="absolute inset-x-2 bottom-0 h-px bg-white" aria-hidden />
            ) : null}
          </button>
        ))}
      </div>
      <div className="[&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none">
        {tabs[active]?.props.children}
      </div>
    </div>
  );
}

const CodeTabsWithTab = Object.assign(CodeTabs, { Tab });
export default CodeTabsWithTab;
export { Tab as CodeTab };
