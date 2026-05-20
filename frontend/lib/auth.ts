const STORAGE_KEY = "obs_api_key";

export const API_BASE: string =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface OnboardPayload {
  email: string;
  name: string;
  company?: string | null;
  useCase: "developer" | "research" | "clinical" | "other";
  agreedToTerms: true;
}

export interface OnboardResult {
  user: {
    id: string;
    email: string;
    name: string;
    company: string | null;
    useCase: OnboardPayload["useCase"];
    createdAt: string;
  };
  apiKey: {
    id: string;
    rawKey: string;
    prefix: string;
    plan: "free";
    monthlyQuota: number;
  };
}

export interface MeResult {
  user: {
    id: string;
    email: string;
    name: string;
    company: string | null;
    useCase: OnboardPayload["useCase"] | null;
    createdAt: string;
  };
  apiKey: {
    id: string;
    prefix: string;
    name: string;
    plan: "free" | "starter" | "pro" | "enterprise";
    monthlyQuota: number;
    createdAt: string;
    lastUsedAt: string | null;
  };
  usageThisMonth: number;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getStoredKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* localStorage unavailable */
  }
}

export function clearStoredKey(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* localStorage unavailable */
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  bearer?: string;
}

export async function apiFetch<T = unknown>(
  path: string,
  { body, bearer, headers, ...rest }: ApiFetchOptions = {},
): Promise<T> {
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const finalHeaders: Record<string, string> = {
    Accept: "application/json",
    ...(headers as Record<string, string> | undefined),
  };

  const token = bearer ?? getStoredKey();
  if (token) {
    finalHeaders.Authorization = `Bearer ${token}`;
  }

  let payload: BodyInit | undefined;
  if (body !== undefined) {
    finalHeaders["Content-Type"] ??= "application/json";
    payload = typeof body === "string" ? body : JSON.stringify(body);
  }

  const res = await fetch(url, {
    ...rest,
    headers: finalHeaders,
    body: payload,
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const code = data?.error?.code ?? `HTTP_${res.status}`;
    const message = data?.error?.message ?? res.statusText;
    throw new ApiError(res.status, code, message, data?.error?.details);
  }

  return data as T;
}

export async function onboard(payload: OnboardPayload): Promise<OnboardResult> {
  return apiFetch<OnboardResult>("/v1/onboard", {
    method: "POST",
    body: payload,
  });
}

export async function fetchMe(bearer?: string): Promise<MeResult> {
  return apiFetch<MeResult>("/v1/me", { bearer });
}
