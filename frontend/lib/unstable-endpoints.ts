/** Endpoints called out in the UI as potentially unstable during the public test phase. */
export const UNSTABLE_API_ENDPOINTS = [
  { method: "POST", path: "/v1/normalize" },
  { method: "POST", path: "/v1/normalize-batch" },
  { method: "POST", path: "/v1/disambiguate" },
  { method: "POST", path: "/v1/translate" },
  { method: "GET", path: "/v1/concepts/:code/ancestors" },
  { method: "GET", path: "/v1/concepts/:code/descendants" },
  { method: "POST", path: "/v1/extract/concepts" },
  { method: "POST", path: "/v1/extract/contexts" },
] as const;

export function formatUnstableEndpoint(e: (typeof UNSTABLE_API_ENDPOINTS)[number]): string {
  return `${e.method} ${e.path}`;
}
