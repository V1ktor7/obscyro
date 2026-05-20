import type { Highlighter, BundledLanguage, BundledTheme } from "shiki";

const LANGS: BundledLanguage[] = [
  "bash",
  "json",
  "javascript",
  "typescript",
  "python",
  "yaml",
  "sql",
];

/** MDX / docs and general inline examples on light UI. */
const THEME_LIGHT: BundledTheme = "github-light";

/** Hero / Features code panels on black background (readable tokens). */
const THEME_DARK_PANEL: BundledTheme = "github-dark-default";

let highlighterPromise: Promise<Highlighter> | null = null;

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then((shiki) =>
      shiki.createHighlighter({
        themes: [THEME_LIGHT, THEME_DARK_PANEL],
        langs: LANGS,
      }),
    );
  }
  return highlighterPromise;
}

export async function highlight(
  code: string,
  lang: BundledLanguage | "text" = "text",
): Promise<string> {
  const hl = await getHighlighter();
  return hl.codeToHtml(code, {
    lang: LANGS.includes(lang as BundledLanguage) ? (lang as BundledLanguage) : "text",
    theme: THEME_LIGHT,
  });
}

/** Syntax colors tuned for `--code-bg` marketing blocks (Hero, Features). */
export async function highlightDarkPanel(
  code: string,
  lang: BundledLanguage | "text" = "text",
): Promise<string> {
  const hl = await getHighlighter();
  return hl.codeToHtml(code, {
    lang: LANGS.includes(lang as BundledLanguage) ? (lang as BundledLanguage) : "text",
    theme: THEME_DARK_PANEL,
  });
}

export const PRETTY_CODE_OPTIONS = {
  theme: THEME_LIGHT,
  defaultLang: "text",
  keepBackground: false,
} as const;
