/**
 * The three values every diagram on the page shares.
 *
 * Ink, a hairline, and one blue. Colour is rationed on purpose: the mark is
 * two rings with a single region where they overlap, and the page follows
 * that rule — monochrome everywhere, colour only where two things meet or
 * where something is actually running.
 *
 * The ground is dark (Gray 100), so the ink is the light grey of the theme's
 * text and the blue is the one that reads as a line on it.
 */
export const SCENE = {
  ink: "#f4f4f4",
  hairline: "rgba(244,244,244,0.16)",
  flow: "#4589ff",
} as const;
