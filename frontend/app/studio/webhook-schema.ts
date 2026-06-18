// Client-side shape for the n8n-style Webhook node configuration.
//
// The editable `WebhookConfig` holds plaintext secrets (password / header value
// / jwt secret) while the user types. On save it is sent to the backend, which
// hashes basic/header secrets and stores the jwt secret. The backend returns a
// `SanitizedWebhookConfig` (no secrets, just `hasSecret` flags), which we hydrate
// back into an editable config with blank secret fields.

export const WEBHOOK_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "ANY"] as const;
export type WebhookMethod = (typeof WEBHOOK_METHODS)[number];

export type WebhookAuthType = "none" | "basic" | "header" | "jwt";

export interface WebhookHeaderKv {
  name: string;
  value: string;
}

export interface WebhookConfig {
  auth: {
    type: WebhookAuthType;
    basic: { username: string; password: string };
    header: { name: string; value: string };
    jwt: { algorithm: "HS256"; secret: string };
  };
  response: {
    code: number;
    contentType: string;
    body: string | null;
    headers: WebhookHeaderKv[];
    noBody: boolean;
  };
  options: {
    allowedOrigins: string;
    ipWhitelist: string[];
    ignoreBots: boolean;
    rawBody: boolean;
    binaryProperty: string | null;
  };
}

/** What the backend returns: no secrets, only presence flags. */
export interface SanitizedWebhookConfig {
  auth: {
    type: WebhookAuthType;
    basic?: { username: string };
    header?: { name: string };
    jwt?: { algorithm: "HS256"; hasSecret: boolean };
  };
  response: WebhookConfig["response"];
  options: WebhookConfig["options"];
}

export function defaultWebhookConfig(): WebhookConfig {
  return {
    auth: {
      type: "none",
      basic: { username: "", password: "" },
      header: { name: "X-Api-Key", value: "" },
      jwt: { algorithm: "HS256", secret: "" },
    },
    response: {
      code: 200,
      contentType: "application/json",
      body: null,
      headers: [],
      noBody: false,
    },
    options: {
      allowedOrigins: "*",
      ipWhitelist: [],
      ignoreBots: true,
      rawBody: false,
      binaryProperty: null,
    },
  };
}

/** Merge a sanitized config from the API onto editable defaults (secrets blank). */
export function fromSanitized(sanitized: SanitizedWebhookConfig | null | undefined): WebhookConfig {
  const base = defaultWebhookConfig();
  if (!sanitized) return base;
  return {
    auth: {
      type: sanitized.auth?.type ?? "none",
      basic: {
        username: sanitized.auth?.basic?.username ?? base.auth.basic.username,
        password: "",
      },
      header: {
        name: sanitized.auth?.header?.name ?? base.auth.header.name,
        value: "",
      },
      jwt: { algorithm: "HS256", secret: "" },
    },
    response: { ...base.response, ...(sanitized.response ?? {}) },
    options: { ...base.options, ...(sanitized.options ?? {}) },
  };
}
