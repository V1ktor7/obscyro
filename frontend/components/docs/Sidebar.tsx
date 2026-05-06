"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOC_NAV, type DocLink } from "@/lib/docs/nav";
import { cn } from "@/lib/cn";

function hrefFor(item: DocLink): string {
  return `/docs/${item.slug.join("/")}`;
}

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="thin-scrollbar h-full overflow-y-auto py-8 pr-4">
      <div className="space-y-7">
        {DOC_NAV.map((section) => (
          <div key={section.title}>
            <h3 className="mb-3 font-mono text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-fg-secondary">
              {section.title}
            </h3>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const href = hrefFor(item);
                const isActive = pathname === href;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      className={cn(
                        "group flex items-center justify-between rounded-md px-3 py-1.5 text-[13px] transition-colors",
                        isActive
                          ? "bg-bg-tertiary font-medium text-fg-primary"
                          : "text-fg-secondary hover:bg-bg-tertiary/60 hover:text-fg-primary",
                      )}
                    >
                      <span className="truncate">{item.title}</span>
                      {item.badge ? (
                        <span className="ml-2 rounded-full border border-border-subtle bg-bg-secondary px-1.5 py-0.5 font-mono text-[0.55rem] uppercase tracking-[0.18em] text-fg-secondary">
                          {item.badge}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
