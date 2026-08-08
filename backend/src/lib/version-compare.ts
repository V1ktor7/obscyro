/**
 * Compare two extension versions, numerically, segment by segment.
 *
 * Lives here rather than beside the migration script that uses it because it
 * is the one piece of that script with a real failure mode, and the failure is
 * silent: PostGIS reports "3.6.0" and pgvector "0.8.6", so a string compare
 * puts "0.10.0" *before* "0.8.6" and reads a downgrade as an upgrade. A
 * preflight check that gets this backwards is worse than no preflight check,
 * because it says the migration is safe.
 *
 * Non-numeric tails are dropped rather than guessed at — PostGIS sometimes
 * carries build detail after the version, and inventing an ordering for it
 * would be a rule nobody could predict.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .split(/[^0-9]+/)
      .filter((s) => s.length > 0)
      .map(Number);
  const xs = parse(a);
  const ys = parse(b);
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    // A missing segment is zero: "3.6" and "3.6.0" are the same version.
    const x = xs[i] ?? 0;
    const y = ys[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
