import { AppError } from "./errors.js";

const UPSTREAM_TIMEOUT_MS = 20_000;

/** POST to the NLP extraction service (`NLP_SERVICE_URL`) with a timeout. */
export async function proxyToNlp<T>(path: string, body: unknown): Promise<T> {
  const base = process.env.NLP_SERVICE_URL?.replace(/\/$/, "");
  if (!base) {
    throw new AppError(
      "NLP_UNAVAILABLE",
      "Extraction service is not configured. Set `NLP_SERVICE_URL`.",
      503,
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    let data: unknown = null;
    try {
      data = await upstream.json();
    } catch {
      data = null;
    }

    if (!upstream.ok) {
      throw new AppError(
        "NLP_UPSTREAM_ERROR",
        "Extraction service returned an error.",
        502,
        data ?? undefined,
      );
    }

    return data as T;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(
      "NLP_UNAVAILABLE",
      "Extraction service is unreachable.",
      503,
    );
  } finally {
    clearTimeout(timer);
  }
}
