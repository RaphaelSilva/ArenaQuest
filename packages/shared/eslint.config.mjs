import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    // entities.ts uses TypeScript namespaces intentionally for domain modeling
    // (Entities.Identity.User, Entities.Content.TopicNode, etc.) — this is the
    // canonical pattern for this codebase and must not be refactored to flat exports.
    files: ["types/entities.ts"],
    rules: {
      "@typescript-eslint/no-namespace": "off",
    },
  },
]);
