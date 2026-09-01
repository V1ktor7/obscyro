/**
 * The three values every diagram on the page shares.
 *
 * Ink, a hairline, and one blue. Colour is rationed on purpose: the mark is
 * black rings with a single region where they overlap, and the page follows
 * that rule — monochrome everywhere, colour only where two things meet or
 * where something is actually running.
 */
export const SCENE = {
  ink: "#1d1d1f",
  hairline: "rgba(29,29,31,0.16)",
  flow: "#1d6fd4",
} as const;
