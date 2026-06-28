import { API_BASE, apiFetch, getStoredKey } from "@/lib/auth";

export interface MetricsSnapshot {
  computedAt: string;
  totalInstances: number;
  byType: Array<{
    typeName: string;
    count: number;
    freshnessSeconds: number | null;
    newestUpdatedAt: string | null;
  }>;
  occupancy: Array<{
    typeName: string;
    property: string;
    value: string;
    count: number;
  }>;
}

export interface InstanceScore {
  instanceId: string;
  typeName: string;
  total: number;
  breakdown: Record<string, number>;
}

function enc(env: string): string {
  return encodeURIComponent(env);
}

export async function fetchMetrics(
  env: string,
  where?: string,
): Promise<MetricsSnapshot> {
  const qs = where?.trim() ? `?where=${encodeURIComponent(where.trim())}` : "";
  return apiFetch(`/v1/ontology/${enc(env)}/metrics${qs}`);
}

export async function fetchInstanceScore(
  env: string,
  instanceId: string,
  definition?: string,
): Promise<InstanceScore> {
  const qs = definition
    ? `?definition=${encodeURIComponent(definition)}`
    : "";
  return apiFetch(
    `/v1/ontology/${enc(env)}/instances/${instanceId}/score${qs}`,
  );
}

/** Parse SSE buffer into JSON payloads from `data:` lines. */
export function parseSseEvents(buffer: string): {
  events: MetricsSnapshot[];
  remainder: string;
} {
  const events: MetricsSnapshot[] = [];
  const parts = buffer.split("\n\n");
  const remainder = parts.pop() ?? "";

  for (const part of parts) {
    for (const line of part.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        events.push(JSON.parse(payload) as MetricsSnapshot);
      } catch {
        /* ignore malformed */
      }
    }
  }

  return { events, remainder };
}

export function subscribeMetricsStream(
  env: string,
  where: string | undefined,
  onData: (metrics: MetricsSnapshot) => void,
  onError: () => void,
): () => void {
  const controller = new AbortController();
  const token = getStoredKey();
  const qs = new URLSearchParams();
  if (where?.trim()) qs.set("where", where.trim());
  const q = qs.toString();
  const url = `${API_BASE}/v1/ontology/${enc(env)}/metrics/stream${q ? `?${q}` : ""}`;

  void (async () => {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "text/event-stream",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        onError();
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, remainder } = parseSseEvents(buffer);
        buffer = remainder;
        for (const evt of events) onData(evt);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") onError();
    }
  })();

  return () => controller.abort();
}
