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

/** Every code block is on a dark panel (`--code-bg`): one theme, with tokens that read on it. */
const THEME_DARK_PANEL: BundledTheme = "github-dark-default";

let highlighterPromise: Promise<Highlighter> | null = null;

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then((shiki) =>
      shiki.createHighlighter({
        themes: [THEME_DARK_PANEL],
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
    theme: THEME_DARK_PANEL,
  });
}

/** The same theme, kept under its older name for the blocks that asked for it. */
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
  theme: THEME_DARK_PANEL,
  defaultLang: "text",
  keepBackground: false,
} as const;
