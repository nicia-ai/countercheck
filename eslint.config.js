import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "public/**",
      "node_modules/**",
      ".wrangler/**",
      ".publication-private/**",
      "eval/data/**",
      "eval/reports/**",
      "coverage/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      "no-console": ["error", { allow: ["log", "error", "warn"] }],
      "no-restricted-globals": ["error", "event", "name"],
    },
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      globals: { ...globals.worker, ...globals.browser },
    },
  },
  {
    files: ["scripts/**/*.ts", "eval/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ["scripts/keys.ts"],
    rules: { "no-console": "off" },
  },
  {
    files: ["*.config.js", "eslint.config.js"],
    languageOptions: {
      globals: globals.node,
    },
  },
  prettier,
);
