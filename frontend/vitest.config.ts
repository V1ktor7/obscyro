import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  // esbuild already transforms .tsx; `automatic` picks up React's modern JSX
  // runtime so component tests need no import of React. @vitejs/plugin-react
  // would only add Fast Refresh, which a test run has no use for — and it
  // conflicts with the Vite that vitest ships.
  esbuild: { jsx: "automatic" },
  test: {
    // `.test.tsx` joins the pattern for component tests. Everything the studio
    // renders was previously verified by types and a production build only, and
    // a build proves a component compiles, not that dragging a bar writes the
    // field it claims to.
    // `lib/` is in the pattern too: it holds the shared vocabulary the studio
    // pages agree on, so a rule that is wrong there is wrong on every page at
    // once. It was outside the glob, which meant a test written for it would
    // have been collected by nothing and passed by never running.
    include: ["app/**/*.test.ts", "app/**/*.test.tsx", "lib/**/*.test.ts"],
    // jsdom only where a test asks for it, via `// @vitest-environment jsdom`.
    // The pure-logic suites are the majority and run an order of magnitude
    // faster in node.
    environment: "node",
  },
});
