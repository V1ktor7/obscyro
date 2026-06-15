/** Routes that skip API-key enforcement and use anonymous rate limits. */
export const PUBLIC_PATH_PATTERNS: RegExp[] = [
  /^\/health\/?$/,
  /^\/v1\/health\/?$/,
  /^\/v1\/onboard\/?$/,
  /^\/v1\/login\/?$/,
  /^\/v1\/keys\/mint\/?$/,
  /^\/v1\/webhooks\/[^/]+\/?$/,
  /^\/documentation(\/.*)?$/,
];

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATH_PATTERNS.some((re) => re.test(path));
}
