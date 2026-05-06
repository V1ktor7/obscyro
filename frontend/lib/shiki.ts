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

const THEMES: { light: BundledTheme; dark: BundledTheme } = {
  light: "github-light",
  dark: "github-dark-default",
};

let highlighterPromise: Promise<Highlighter> | null = null;

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then((shiki) =>
      shiki.createHighlighter({
        themes: [THEMES.light, THEMES.dark],
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
    themes: THEMES,
    defaultColor: false,
  });
}

export const PRETTY_CODE_OPTIONS = {
  themes: THEMES,
  defaultLang: "text",
  keepBackground: false,
} as const;
