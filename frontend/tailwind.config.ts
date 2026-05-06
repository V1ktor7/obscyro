import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  darkMode: "class",
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
      borderRadius: {
        xl: "0.875rem",
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
