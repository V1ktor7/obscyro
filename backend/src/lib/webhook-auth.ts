import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Webhook inbound authentication + gating helpers.
//
// Secrets for basic/header auth are persisted as SHA-256 hashes and compared in
// constant time. JWT (HS256) is verified with the shared secret stored on the
// source. None of these helpers throw; callers decide the HTTP response.
// ---------------------------------------------------------------------------

export type WebhookAuthType = "none" | "basic" | "header" | "jwt";

export interface WebhookAuth {
  type: WebhookAuthType;
  basic?: { username: string; passwordHash: string };
  header?: { name: string; valueHash: string };
  jwt?: { algorithm: "HS256"; secret: string };
}

export function hashSecret(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function base64UrlDecode(input: string): string {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf8");
}

export function verifyBasic(authHeader: string | undefined, cfg: WebhookAuth["basic"]): boolean {
  if (!cfg) return false;
  if (!authHeader?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(authHeader.slice(6).trim(), "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  if (idx < 0) return false;
  const username = decoded.slice(0, idx);
  const password = decoded.slice(idx + 1);
  return safeEqual(username, cfg.username) && safeEqual(hashSecret(password), cfg.passwordHash);
}

export function verifyHeader(
  headerValue: string | undefined,
  cfg: WebhookAuth["header"],
): boolean {
  if (!cfg) return false;
  if (typeof headerValue !== "string") return false;
  return safeEqual(hashSecret(headerValue), cfg.valueHash);
}

/** Verify an HS256 JWT from `Authorization: Bearer <token>`; checks signature + exp. */
export function verifyJwtHS256(
  authHeader: string | undefined,
  cfg: WebhookAuth["jwt"],
): boolean {
  if (!cfg?.secret) return false;
  if (!authHeader?.startsWith("Bearer ")) return false;
  const token = authHeader.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, signatureB64] = parts;

  const expected = crypto
    .createHmac("sha256", cfg.secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  if (!safeEqual(expected, signatureB64)) return false;

  try {
    const payload = JSON.parse(base64UrlDecode(payloadB64)) as { exp?: number; nbf?: number };
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === "number" && now >= payload.exp) return false;
    if (typeof payload.nbf === "number" && now < payload.nbf) return false;
  } catch {
    return false;
  }
  return true;
}

const BOT_UA = /(bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|curlbot|headless)/i;

export function isBot(userAgent: string | undefined): boolean {
  if (!userAgent) return false;
  return BOT_UA.test(userAgent);
}

export function ipAllowed(ip: string | undefined, whitelist: string[]): boolean {
  if (!whitelist || whitelist.length === 0) return true;
  if (!ip) return false;
  // Normalize IPv4-mapped IPv6 (::ffff:1.2.3.4) to the bare IPv4 form.
  const normalized = ip.replace(/^::ffff:/, "");
  return whitelist.some((entry) => {
    const e = entry.trim();
    return e === ip || e === normalized;
  });
}
