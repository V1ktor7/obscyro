"use client";

/**
 * Global navigation shell (spec Part 3.1/3.2): a 56px icon rail plus a
 * contextual sub-navigation column. Sections are filtered by the capabilities
 * returned from /v1/me — hidden entirely rather than disabled, per §3.2.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import {
  Activity,
  Box,
  Home,
  Database,
  LineChart,
  Map as MapIcon,
  Settings,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/cn";

import { NAV_SECTIONS, sectionForPath, type NavSection } from "./platform-nav";

const ICONS: Record<string, LucideIcon> = {
  Home,
  Database,
  Workflow,
  Box,
  LineChart,
  Map: MapIcon,
  Activity,
  ShieldCheck,
  Settings,
};

export default function PlatformRail({ capabilities }: { capabilities: string[] | null }) {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const view = searchParams?.get("view") ?? null;
  const active = sectionForPath(pathname);

  // Until identity resolves, show everything rather than flashing an empty
  // rail; the server rejects anything the role cannot actually reach.
  const visible = capabilities
    ? NAV_SECTIONS.filter(
        (s) => s.capability === "*" || capabilities.includes(s.capability),
      )
    : NAV_SECTIONS;

  return (
    <>
      <nav
        aria-label="Sections"
        className="flex w-14 shrink-0 flex-col border-r border-[#d3d8de] bg-[#f6f7f9] py-1.5"
      >
        {visible.map((s) => {
          const Icon = ICONS[s.icon] ?? Box;
          const on = active?.id === s.id;
          return (
            <Link
              key={s.id}
              href={s.href}
              aria-current={on ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 transition-colors",
                on
                  ? "bg-[#e7f2fd] text-[#215db0] shadow-[inset_2px_0_0_#2d72d2]"
                  : "text-[#5f6b7c] hover:text-[#1c2127]",
              )}
            >
              <Icon className="h-[17px] w-[17px]" />
              <span className="text-[8.5px] leading-none">{s.label}</span>
            </Link>
          );
        })}
      </nav>

      {active ? <SubNav section={active} pathname={pathname} view={view} /> : null}
    </>
  );
}

function SubNav({
  section,
  pathname,
  view,
}: {
  section: NavSection;
  pathname: string;
  view: string | null;
}) {
  return (
    <aside
      aria-label={`${section.label} navigation`}
      className="w-[172px] shrink-0 overflow-y-auto border-r border-[#d3d8de] bg-white py-2"
    >
      {section.groups.map((g, i) => (
        <div key={g.title ?? i}>
          {g.title ? (
            <p className="px-3 py-1.5 text-[9.5px] font-medium uppercase tracking-[0.06em] text-[#8f99a8]">
              {g.title}
            </p>
          ) : null}
          {g.items.map((item) => {
            const itemPath = item.href.split("?")[0];
            // A view-scoped item matches on ?view=; a plain item matches on path.
            const on = item.view
              ? pathname.startsWith(itemPath) && view === item.view
              : pathname.startsWith(itemPath) &&
                !section.groups.some((gg) => gg.items.some((x) => x.view === view && view));
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "block px-3 py-1.5 text-xs transition-colors",
                  on
                    ? "bg-[#e7f2fd] font-medium text-[#215db0]"
                    : "text-[#1c2127] hover:bg-[#f6f7f9]",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
