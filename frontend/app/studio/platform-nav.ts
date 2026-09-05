/**
 * Platform information architecture (spec Part 3.2).
 *
 * Only sections backed by working code appear here. The specification's rail
 * has ~20 sections; inventing the ones we have not built would produce a maze
 * of dead links, and §3.2 is explicit that inaccessible entries are hidden
 * rather than shown disabled.
 *
 * `capability` matches the strings returned by GET /v1/me so the rail is
 * role-filtered. Server-side checks remain the actual access control.
 */

export interface NavItem {
  label: string;
  href: string;
  /** Marks the item active when the current URL carries this ?view= value. */
  view?: string;
}

/**
 * Whether a sub-navigation entry is the one the reader is looking at.
 *
 * The rule has to read the query string, not only the path. Three entries under
 * Models all point at `/studio/lab` and differ only by `?tab=`, so a
 * path-prefix test lit all three at once — a sub-navigation whose highlight
 * says "you are in all of these" tells the reader nothing about where they are.
 *
 * Every parameter the entry names must match. An entry that names none is the
 * section's landing page, and it yields to any sibling whose parameters do
 * match, so `/studio/lab?tab=causality` highlights Causality rather than both.
 */
export function navItemActive(
  item: NavItem,
  pathname: string,
  params: URLSearchParams | null,
  siblings: NavItem[] = [],
): boolean {
  const wanted = itemParams(item);
  if (!pathname.startsWith(path(item))) return false;
  for (const [key, value] of wanted) {
    if ((params?.get(key) ?? null) !== value) return false;
  }
  if (wanted.length > 0) return true;
  return !siblings.some(
    (other) =>
      other !== item && itemParams(other).length > 0 && navItemActive(other, pathname, params),
  );
}

function path(item: NavItem): string {
  return item.href.split("?")[0]!;
}

/**
 * The parameters an entry claims — from its own href, plus the legacy `view`
 * field, so entries written either way behave the same.
 */
function itemParams(item: NavItem): [string, string][] {
  const query = item.href.split("?")[1];
  const out: [string, string][] = query
    ? Array.from(new URLSearchParams(query).entries())
    : [];
  if (item.view && !out.some(([k]) => k === "view")) out.push(["view", item.view]);
  return out;
}

export interface NavSection {
  id: string;
  label: string;
  /** Tabler-style lucide icon name resolved in PlatformRail. */
  icon: string;
  capability: string;
  href: string;
  groups: { title?: string; items: NavItem[] }[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: "home",
    label: "Home",
    icon: "Home",
    // Always visible: it is how you reach a project without a dropdown.
    capability: "*",
    href: "/studio/home",
    groups: [{ items: [{ label: "Overview", href: "/studio/home" }] }],
  },
  {
    id: "data",
    label: "Data",
    icon: "Database",
    capability: "data",
    href: "/studio/data",
    groups: [
      {
        title: "Workspace",
        items: [{ label: "Projects & datasets", href: "/studio/data" }],
      },
      {
        title: "Connect",
        items: [
          { label: "Sources", href: "/studio/sources?view=sources", view: "sources" },
          { label: "Syncs", href: "/studio/sources?view=syncs", view: "syncs" },
        ],
      },
      {
        title: "Legacy",
        items: [
          { label: "Channels", href: "/studio/parser" },
          { label: "Feed simulator", href: "/studio/lab?tab=feed" },
        ],
      },
    ],
  },
  {
    id: "dashboards",
    label: "Dashboard",
    icon: "LayoutGrid",
    capability: "dashboards",
    href: "/studio/dashboards",
    groups: [{ items: [{ label: "Boards", href: "/studio/dashboards" }] }],
  },
  {
    id: "pipelines",
    label: "Lineage",
    icon: "Workflow",
    capability: "pipelines",
    href: "/studio/lineage",
    groups: [
      {
        items: [
          { label: "Graph", href: "/studio/lineage" },
          { label: "Builder", href: "/studio/pipelines" },
        ],
      },
    ],
  },
  {
    id: "ontology",
    label: "Ontology",
    icon: "Box",
    capability: "ontology",
    href: "/studio/manager",
    groups: [
      {
        title: "Model",
        items: [
          { label: "Discover", href: "/studio/manager?view=discover", view: "discover" },
          { label: "Object types", href: "/studio/manager?view=objectTypes", view: "objectTypes" },
          { label: "Link types", href: "/studio/manager?view=linkTypes", view: "linkTypes" },
          { label: "Properties", href: "/studio/manager?view=properties", view: "properties" },
          { label: "Schema graph", href: "/studio/manager?view=schema", view: "schema" },
        ],
      },
      {
        title: "Explore",
        items: [
          { label: "Instances", href: "/studio/manager?view=instances", view: "instances" },
          { label: "Proposals", href: "/studio/manager?view=proposals", view: "proposals" },
          { label: "History", href: "/studio/manager?view=history", view: "history" },
        ],
      },
      {
        title: "Resources",
        items: [
          { label: "Action types", href: "/studio/manager?view=actionTypes", view: "actionTypes" },
          { label: "Type groups", href: "/studio/manager?view=typeGroups", view: "typeGroups" },
          { label: "Value sets", href: "/studio/manager?view=valueSets", view: "valueSets" },
          { label: "Functions", href: "/studio/manager?view=functions", view: "functions" },
        ],
      },
      {
        title: "Maintenance",
        items: [
          { label: "Health issues", href: "/studio/manager?view=health", view: "health" },
          { label: "Cleanup", href: "/studio/manager?view=cleanup", view: "cleanup" },
          { label: "Configuration", href: "/studio/manager?view=config", view: "config" },
        ],
      },
    ],
  },
  {
    id: "models",
    label: "Models",
    icon: "LineChart",
    capability: "models",
    href: "/studio/lab",
    groups: [
      {
        // One entry per tab the lab actually has. Three of the seven were
        // listed and four were reachable only by clicking inside the page.
        items: [
          { label: "Models", href: "/studio/lab?tab=models" },
          { label: "Notebook", href: "/studio/lab?tab=notebook" },
          { label: "Forecast", href: "/studio/lab?tab=forecast" },
          { label: "Causality", href: "/studio/lab?tab=causality" },
          { label: "Signal model", href: "/studio/lab?tab=train" },
          { label: "Simulate vs reality", href: "/studio/lab?tab=compare" },
          { label: "Feed simulator", href: "/studio/lab?tab=feed" },
        ],
      },
    ],
  },
  {
    id: "twin",
    label: "Twin",
    icon: "Map",
    capability: "twin",
    href: "/studio/response",
    groups: [
      {
        items: [
          // Three of these were reachable only by typing the URL.
          { label: "Response", href: "/studio/response" },
          { label: "Units", href: "/studio/command" },
          { label: "Network", href: "/studio/live" },
          { label: "Scenarios", href: "/studio/simulation" },
          { label: "Events", href: "/studio/events" },
        ],
      },
    ],
  },
  {
    id: "health",
    label: "Health",
    icon: "Activity",
    capability: "health",
    href: "/studio/flux",
    groups: [{ items: [{ label: "Data flux", href: "/studio/flux" }] }],
  },
  {
    id: "govern",
    label: "Govern",
    icon: "ShieldCheck",
    capability: "govern",
    href: "/studio/govern",
    groups: [
      {
        items: [
          { label: "Audit log", href: "/studio/govern?view=audit", view: "audit" },
          { label: "Review queue", href: "/studio/govern?view=review", view: "review" },
        ],
      },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    icon: "Settings",
    capability: "admin",
    href: "/studio/admin",
    groups: [
      {
        items: [
          { label: "Users & roles", href: "/studio/admin?view=members", view: "members" },
          { label: "Environments", href: "/studio/admin?view=environments", view: "environments" },
        ],
      },
    ],
  },
];

/** Which section a pathname belongs to (longest prefix wins). */
export function sectionForPath(pathname: string): NavSection | null {
  const byPrefix: Record<string, string> = {
    "/studio/home": "home",
    "/studio/parser": "data",
    "/studio/data": "data",
    "/studio/sources": "data",
    "/studio/dashboards": "dashboards",
    "/studio/workspace": "pipelines",
    "/studio/lineage": "pipelines",
    "/studio/pipelines": "pipelines",
    "/studio/manager": "ontology",
    "/studio/lab": "models",
    "/studio/response": "twin",
    "/studio/command": "twin",
    "/studio/live": "twin",
    "/studio/events": "twin",
    "/studio/simulation": "twin",
    "/studio/flux": "health",
    "/studio/govern": "govern",
    "/studio/admin": "admin",
  };
  const hit = Object.keys(byPrefix)
    .filter((p) => pathname.startsWith(p))
    .sort((a, b) => b.length - a.length)[0];
  return hit ? (NAV_SECTIONS.find((s) => s.id === byPrefix[hit]) ?? null) : null;
}
