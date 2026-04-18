import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**", ".wrangler/**", "worker-configuration.d.ts"],
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
]);
