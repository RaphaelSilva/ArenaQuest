declare module "cloudflare:test" {
	interface ProvidedEnv extends Env {
    DB: D1Database;
}
}

// Vite resolves import.meta.glob at bundle time. This declaration tells
// TypeScript about the API shape so the IDE doesn't flag it as unknown.
interface ImportMetaGlobOptions {
  query?: string;
  import?: string;
  eager?: boolean;
}

interface ImportMeta {
  glob(pattern: string, options?: ImportMetaGlobOptions): Record<string, unknown>;
}
