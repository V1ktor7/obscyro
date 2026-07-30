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
        items: [
          { label: "Causality", href: "/studio/lab?tab=causality" },
          { label: "Train", href: "/studio/lab?tab=train" },
          { label: "Simulate", href: "/studio/lab?tab=compare" },
        ],
      },
    ],
  },
  {
    id: "twin",
    label: "Twin",
    icon: "Map",
    capability: "twin",
    href: "/studio/command",
    groups: [{ items: [{ label: "Unit canvas", href: "/studio/command" }] }],
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
    "/studio/workspace": "pipelines",
    "/studio/lineage": "pipelines",
    "/studio/manager": "ontology",
    "/studio/lab": "models",
    "/studio/command": "twin",
    "/studio/live": "twin",
    "/studio/flux": "health",
    "/studio/govern": "govern",
    "/studio/admin": "admin",
  };
  const hit = Object.keys(byPrefix)
    .filter((p) => pathname.startsWith(p))
    .sort((a, b) => b.length - a.length)[0];
  return hit ? (NAV_SECTIONS.find((s) => s.id === byPrefix[hit]) ?? null) : null;
}
