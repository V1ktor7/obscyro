import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site-url";

/**
 * The product and the console sit behind a sign-in, and the documentation is
 * no longer part of what the site offers. None of the three belongs in search
 * results.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/docs", "/app", "/studio"] }],
    sitemap: new URL("/sitemap.xml", SITE_URL).toString(),
  };
}
