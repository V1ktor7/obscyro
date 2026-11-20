"use client";

/**
 * Global navigation (spec Part 3.1/3.2): a 56px icon rail for the sections,
 * and the pages of the section one is in.
 *
 * The pages are a row of tabs above the page, so the page keeps the whole
 * width: a map is the page, and a column of links beside it would take a fifth
 * of it for good. One section (Ontology) has more pages than a row can hold on
 * a laptop; it alone keeps a list down the side, because a row that scrolls
 * hides the pages past its edge.
 *
 * Sections are filtered by the capabilities returned from /v1/me — hidden
 * entirely rather than disabled, per §3.2.
 */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import {
  Activity,
  Box,
  Home,
  Database,
  LayoutGrid,
  LineChart,
  Map as MapIcon,
  Settings,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/cn";

import { NAV_SECTIONS, navItemActive, sectionForPath, type NavSection } from "./platform-nav";

const ICONS: Record<string, LucideIcon> = {
  Home,
  Database,
  LayoutGrid,
  Workflow,
  Box,
  LineChart,
  Map: MapIcon,
  Activity,
  ShieldCheck,
  Settings,
};

/** Past this many pages a section is listed down the side instead of across the top. */
export const TAB_ROW_MAX = 8;

/** Whether a section's pages fit in a row of tabs. */
export function fitsInTabs(section: NavSection): boolean {
  return section.groups.reduce((n, g) => n + g.items.length, 0) <= TAB_ROW_MAX;
}

/** The blue bar that marks where one is: on the left of a rail entry, under a tab. */
const HERE_LEFT = "shadow-[inset_3px_0_0_rgb(var(--s-brand-edge))]";

export default function PlatformRail({ capabilities }: { capabilities: string[] | null }) {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
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
        className="flex w-14 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-canvas py-2"
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
                "flex flex-col items-center gap-1 py-2 transition-colors",
                on ? cn("bg-surface text-ink", HERE_LEFT) : "text-ink-faint hover:bg-surface hover:text-ink",
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={1.75} />
              <span className="text-[10px] leading-none tracking-[0.02em]">{s.label}</span>
            </Link>
          );
        })}
      </nav>

      {active && !fitsInTabs(active) ? <SideList section={active} pathname={pathname} params={searchParams} /> : null}
    </>
  );
}

/**
 * The pages of the current section, as a row of tabs above the page.
 *
 * Renders nothing for a section listed down the side, and nothing outside any
 * section.
 */
export function SectionTabs() {
  const pathname = usePathname() ?? "";
  const params = useSearchParams();
  const section = sectionForPath(pathname);
  if (!section || !fitsInTabs(section)) return null;

  return (
    <nav
      aria-label={`${section.label} navigation`}
      className="flex h-11 shrink-0 items-stretch overflow-x-auto border-b border-line bg-canvas pl-6 pr-4"
    >
      <span className="mr-6 flex shrink-0 items-center text-[14px] font-semibold text-ink">{section.label}</span>
      {section.groups.map((g, i) => (
        <div key={g.title ?? i} className="flex shrink-0 items-stretch">
          {g.title ? (
            <span
              className={cn(
                "flex items-center pr-2 text-[10px] uppercase tracking-[0.06em] text-ink-faint",
                i > 0 && "ml-3 border-l border-line pl-4",
              )}
            >
              {g.title}
            </span>
          ) : null}
          {g.items.map((item) => {
            const on = navItemActive(item, pathname, params, g.items);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "flex items-center whitespace-nowrap border-b-2 px-4 text-[13px] transition-colors",
                  on
                    ? "border-brand font-semibold text-ink"
                    : "border-transparent text-ink-muted hover:border-line-strong hover:text-ink",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function SideList({
  section,
  pathname,
  params,
}: {
  section: NavSection;
  pathname: string;
  params: URLSearchParams | null;
}) {
  return (
    <aside
      aria-label={`${section.label} navigation`}
      className="w-[176px] shrink-0 overflow-y-auto border-r border-line bg-canvas pb-3"
    >
      <p className="flex h-11 items-center px-4 text-[14px] font-semibold text-ink">{section.label}</p>
      {section.groups.map((g, i) => (
        <div key={g.title ?? i} className="pb-2">
          {g.title ? (
            <p className="px-4 pb-1 pt-2 text-[10px] uppercase tracking-[0.06em] text-ink-faint">
              {g.title}
            </p>
          ) : null}
          {g.items.map((item) => {
            const on = navItemActive(item, pathname, params, g.items);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "block px-4 py-1.5 text-[12.5px] transition-colors",
                  on
                    ? cn("bg-surface font-semibold text-ink", HERE_LEFT)
                    : "text-ink-muted hover:bg-surface hover:text-ink",
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
