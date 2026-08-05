import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

// Flat config (Next 16 removed `next lint` — the ESLint CLI is the entry point).
// core-web-vitals + typescript rule-sets, with eslint-config-prettier LAST so
// Prettier owns all formatting and ESLint owns correctness.
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,

  // The pure engine (`src/game/**`) and the Node test scripts contain no React.
  // Functions like `useItem`/`useAbility` are game actions that merely start
  // with "use", so the React-hooks rules only misfire here — turn them off.
  {
    files: ["src/game/**/*.{ts,tsx}", "scripts/**/*.{ts,mts}"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "node_modules/**",
    "next-env.d.ts",
    // Design handoff bundles are static prototypes, not app source — they ship
    // their own vendored runtime and are never built or imported.
    "design_handoff_*/**",
  ]),
]);
