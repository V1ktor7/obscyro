import type { MetadataRoute } from "next";

import { FEATURES, featureHref } from "@/lib/features";
import { SITE_URL } from "@/lib/site-url";


/** What the site offers to someone arriving: the home page, the six features, the terms. */
export default function sitemap(): MetadataRoute.Sitemap {
  const pages = ["/", ...FEATURES.map((f) => featureHref(f.slug)), "/terms", "/privacy"];
  return pages.map((path) => ({
    url: new URL(path, SITE_URL).toString(),
    changeFrequency: "monthly",
    priority: path === "/" ? 1 : path.startsWith("/features") ? 0.8 : 0.3,
  }));
}
