/**
 * An amount held in whole cents, as a person reads it: "1,500,000 $",
 * "1,250.50 $".
 *
 * Formatting only. Every sum shown anywhere is the server's, in cents: nothing
 * on a screen adds two amounts or rounds one.
 */
export function money(cents: number): string {
  const whole = cents % 100 === 0;
  return `${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })} $`;
}
