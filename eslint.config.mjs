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
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
);
