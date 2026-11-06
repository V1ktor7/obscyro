/**
 * The address the site is published at, for links that leave the page: the
 * preview image a chat app shows, the canonical URL, the sitemap.
 *
 * The fallback used to be localhost everywhere, and NEXT_PUBLIC_SITE_URL was
 * never set on the deployment. So the live site announced itself as
 * http://localhost:3000 — every link shared to LinkedIn, Slack or an email
 * client arrived without its image, because the image lived on the reader's
 * own machine. A production build now defaults to the real domain; the
 * variable still wins when it is set.
 */
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.NODE_ENV === "production" ? "https://www.obscyro.com" : "http://localhost:3000");
