import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

/**
 * A Studio colour, read from a CSS variable.
 *
 * The variables hold three numbers ("38 38 38"), not a hex value, so that an
 * opacity suffix (`bg-surface/95`, `border-danger/40`) still works. Their
 * values are in `app/globals.css`: the light ones on `:root`, the Studio's on
 * `.theme-g100`.
 */
const studio = (name: string) => `rgb(var(--s-${name}) / <alpha-value>)`;

/**
 * Brand blue is three blues once the ground is dark.
 *
 * A filled button wants the deep one (white text has to stay readable on it), a
 * link wants the pale one (it is text on a dark panel), and a one-pixel outline
 * wants the one in between. The class name stays `brand` everywhere; what it
 * gives depends on what is being painted. On `:root` the three are the same.
 */
const brandText = { brand: { DEFAULT: studio("brand-text"), deep: studio("brand-text-deep") } };
const brandEdge = { brand: { DEFAULT: studio("brand-edge"), deep: studio("brand-text") } };

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./content/**/*.{md,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: "1.5rem",
        sm: "2rem",
        lg: "2.5rem",
      },
      screens: {
        "2xl": "1280px",
      },
    },
    extend: {
      colors: {
        // --- Studio palette -------------------------------------------------
        //
        // Every colour the Studio paints with has a name here and a value in
        // `app/globals.css`. A screen never writes a hex value: it names a
        // role, and the theme says what that role looks like. The Studio runs
        // on the dark theme (`.theme-g100`, IBM Carbon Gray 100); the light
        // values on `:root` are what the public site's product tour draws with.
        ink: {
          DEFAULT: studio("ink"), // headings, primary text
          body: studio("ink-body"),
          muted: studio("ink-muted"),
          faint: studio("ink-faint"), // labels, metadata
          ghost: studio("ink-ghost"), // disabled, inactive dots
        },
        // Text on something filled with `ink`, or with a severity colour.
        inverse: studio("inverse"),
        line: {
          DEFAULT: studio("line"), // panel and card borders
          soft: studio("line-soft"), // dividers inside a panel
          faint: studio("line-faint"), // row separators
          strong: studio("line-strong"), // a border that has to be seen: a field, a handle
        },
        canvas: {
          DEFAULT: studio("canvas"), // the page behind the panels
          raised: studio("canvas-raised"), // inset blocks on a panel
        },
        surface: {
          DEFAULT: studio("surface"), // panels, cards, fields
          hover: studio("surface-hover"), // a row or a quiet button under the pointer
        },
        brand: {
          DEFAULT: studio("brand"), // a filled button
          deep: studio("brand-deep"), // the same button under the pointer
          soft: studio("brand-soft"), // selected rows, active chips
          line: studio("brand-line"), // the border of something on brand-soft
        },
        // Severity. `ink` variants exist because the mid tone fails contrast on
        // its own soft background.
        ok: { DEFAULT: studio("ok"), soft: studio("ok-soft"), line: studio("ok-line"), ink: studio("ok-ink") },
        warn: { DEFAULT: studio("warn"), soft: studio("warn-soft"), line: studio("warn-line"), ink: studio("warn-ink") },
        danger: { DEFAULT: studio("danger"), soft: studio("danger-soft"), line: studio("danger-line"), ink: studio("danger-ink") },
        // Scenario overlay — deliberately not a severity. It means "you are not
        // looking at reality", which is a different axis from "this is bad".
        scenario: { DEFAULT: studio("scenario"), soft: studio("scenario-soft"), line: studio("scenario-line") },
        // Capacity an option adds. Not a severity either.
        teal: { DEFAULT: studio("teal"), soft: studio("teal-soft") },

        bg: {
          DEFAULT: "var(--bg-primary)",
          primary: "var(--bg-primary)",
          secondary: "var(--bg-secondary)",
          tertiary: "var(--bg-tertiary)",
        },
        fg: {
          DEFAULT: "var(--text-primary)",
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
        },
        border: {
          DEFAULT: "var(--border-subtle)",
          subtle: "var(--border-subtle)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          fg: "var(--accent-fg)",
        },
        card: "var(--card-bg)",
        code: {
          bg: "var(--code-bg)",
          fg: "var(--code-fg)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      letterSpacing: {
        "widest-x": "0.2em",
        "widest-xx": "0.3em",
      },
      boxShadow: {
        "accent-soft": "0 12px 24px -16px rgba(17,17,17,0.20)",
        "code": "0 24px 64px -24px rgba(0,0,0,0.5)",
      },
      textColor: brandText,
      placeholderColor: brandText,
      textDecorationColor: brandEdge,
      borderColor: brandEdge,
      ringColor: brandEdge,
      outlineColor: brandEdge,
      accentColor: brandEdge,
      fill: brandEdge,
      stroke: brandEdge,
      // A fill that carries white text: the pale purple of `scenario` cannot.
      backgroundColor: { scenario: { DEFAULT: studio("scenario-fill") } },
      // The Studio's corners are square. Each radius reads a variable the theme
      // sets to zero, and falls back to Tailwind's own value everywhere else.
      // `rounded-full` is untouched: a dot and a pill stay round.
      borderRadius: {
        sm: "var(--radius-sm, 0.125rem)",
        DEFAULT: "var(--radius, 0.25rem)",
        md: "var(--radius-md, 0.375rem)",
        lg: "var(--radius-lg, 0.5rem)",
        xl: "var(--radius-xl, 0.875rem)",
        "2xl": "var(--radius-2xl, 1rem)",
        "3xl": "var(--radius-3xl, 1.5rem)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        scan: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.4s ease-out both",
        scan: "scan 3s linear infinite",
      },
      typography: ({ theme }: { theme: (path: string) => string }) => ({
        DEFAULT: {
          css: {
            "--tw-prose-body": "var(--text-primary)",
            "--tw-prose-headings": "var(--text-primary)",
            "--tw-prose-lead": "var(--text-secondary)",
            "--tw-prose-links": "var(--text-primary)",
            "--tw-prose-bold": "var(--text-primary)",
            "--tw-prose-counters": "var(--text-secondary)",
            "--tw-prose-bullets": "var(--text-secondary)",
            "--tw-prose-hr": "var(--border-subtle)",
            "--tw-prose-quotes": "var(--text-primary)",
            "--tw-prose-quote-borders": "var(--border-subtle)",
            "--tw-prose-captions": "var(--text-secondary)",
            "--tw-prose-code": "var(--text-primary)",
            "--tw-prose-pre-code": "var(--code-fg)",
            "--tw-prose-pre-bg": "var(--code-bg)",
            "--tw-prose-th-borders": "var(--border-subtle)",
            "--tw-prose-td-borders": "var(--border-subtle)",
            "--tw-prose-invert-body": "var(--text-primary)",
            "--tw-prose-invert-headings": "var(--text-primary)",
            "--tw-prose-invert-links": "var(--text-primary)",
            "--tw-prose-invert-bold": "var(--text-primary)",
            "--tw-prose-invert-hr": "var(--border-subtle)",
            "--tw-prose-invert-th-borders": "var(--border-subtle)",
            "--tw-prose-invert-td-borders": "var(--border-subtle)",
            maxWidth: "none",
            a: {
              textDecoration: "underline",
              textDecorationColor: "var(--border-subtle)",
              textUnderlineOffset: "3px",
              fontWeight: "500",
              "&:hover": {
                textDecorationColor: "var(--text-primary)",
              },
            },
            "h1, h2, h3, h4": {
              letterSpacing: "-0.015em",
              scrollMarginTop: "6rem",
            },
            "code::before": { content: "none" },
            "code::after": { content: "none" },
            code: {
              fontWeight: "500",
              padding: "0.15em 0.4em",
              borderRadius: "0.35rem",
              backgroundColor: "var(--bg-tertiary)",
              border: "1px solid var(--border-subtle)",
              fontSize: "0.85em",
            },
            pre: {
              border: "1px solid rgba(255,255,255,0.05)",
              borderRadius: "0.75rem",
              padding: "1rem 1.25rem",
            },
            "pre code": {
              backgroundColor: "transparent",
              border: "none",
              padding: "0",
              fontSize: "0.85em",
              fontWeight: "400",
            },
            table: {
              fontSize: "0.9rem",
            },
            "thead th": {
              fontFamily: "var(--font-mono)",
              fontSize: "0.7rem",
              textTransform: "uppercase",
              letterSpacing: "0.15em",
              color: "var(--text-secondary)",
              fontWeight: "600",
            },
          },
        },
      }),
    },
  },
  plugins: [typography],
};

export default config;
