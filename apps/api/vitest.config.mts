import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";
import path from "path";

export default defineWorkersConfig({
	resolve: {
		alias: {
			"@api": path.resolve(__dirname, "./src")
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
						ALLOWED_ORIGIN: "*",
						COOKIE_SAMESITE: "Strict",
						MAIL_DRIVER: "console",
						MAIL_FROM: "ArenaQuest Test <noreply@test.local>",
						RESEND_API_KEY: "test-key-unused",
						WEB_BASE_URL: "http://localhost:3000",
						R2_S3_ENDPOINT: "http://localhost:4566",
						R2_BUCKET_NAME: "test-bucket",
						R2_PUBLIC_BASE: "",
						R2_ACCESS_KEY_ID: "test-access-key",
						R2_SECRET_ACCESS_KEY: "test-secret-key-at-least-32-chars-long",
					},
					d1Databases: ["DB"],
					r2Buckets: ["R2"],
					kvNamespaces: ["RATE_LIMIT_KV"],
				},
			},
		},
	},
});
