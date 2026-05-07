import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import path from "path";

export default defineWorkersConfig({
	resolve: {
		alias: {
			"@api": path.resolve(__dirname, "./src"),
		},
	},
	test: {
		poolOptions: {
			workers: {
				wrangler: { configPath: "./wrangler.jsonc" },
				miniflare: {
					bindings: {
						JWT_SECRET: "test-secret-at-least-32-characters-long",
						ALLOWED_ORIGINS: "*",
						COOKIE_SAMESITE: "Lax",
						MAIL_DRIVER: "console",
						MAIL_FROM: "ArenaQuest Test <noreply@test.local>",
						RESEND_API_KEY: "test-key-unused",
						WEB_BASE_URL: "http://localhost:3000",
					},
					d1Databases: ["DB"],
					r2Buckets: ["R2"],
					kvNamespaces: ["RATE_LIMIT_KV"],
				},
			},
		},
	},
});
