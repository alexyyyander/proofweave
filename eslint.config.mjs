import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated output, archived release evidence, and local worktrees are not
    // source: linting them is slow and can surface errors from other branches.
    "dist/**",
    "outputs/**",
    "work/**",
    ".wrangler/**",
    ".claude/**",
  ]),
]);

export default eslintConfig;
