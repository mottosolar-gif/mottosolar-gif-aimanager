import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/*.js", "**/*.mjs", "**/*.cjs"] },
  {
    files: ["worker/src/**/*.ts", "worker/test/**/*.ts", "vitest.config.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      // Together these reject both discarded promises and promises misused as
      // boolean values, including `if (canView(...))` without `await`.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
);
