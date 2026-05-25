import { defineConfig } from "vitest/config";
import { defineWorkersProject } from "@cloudflare/vitest-pool-workers/config";
import path from "path";

const alias = { "@api": path.resolve(__dirname, "./src") };

export default defineConfig({
	test: {
		projects: [
			// A spec belongs to `workers` iff it imports `cloudflare:test` or
			// depends on Miniflare bindings (D1, R2, KV, Worker fetch).
			defineWorkersProject({
				resolve: { alias },
				test: {
					name: "workers",
					include: [
						"test/db/**/*.spec.ts",
						"test/routes/**/*.spec.ts",
						"test/index.spec.ts",
					],
					exclude: [
						"test/routes/parse-cookie-samesite.spec.ts",
					],
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
									GOOGLE_CLIENT_ID: "test-google-client-id",
									GOOGLE_CLIENT_SECRET: "test-google-client-secret",
									GOOGLE_REDIRECT_URI: "http://localhost:8787/auth/google/callback",
								},
								d1Databases: ["DB"],
								r2Buckets: ["R2"],
								kvNamespaces: ["RATE_LIMIT_KV"],
							},
						},
					},
				},
			}),
			// All other specs: pure-unit tests that do NOT import `cloudflare:test`.
			// Run on default Node pool — no Miniflare boot cost.
			{
				resolve: { alias },
				test: {
					name: "node",
					environment: "node",
					include: [
						"test/adapters/**/*.spec.ts",
						"test/controllers/**/*.spec.ts",
						"test/core/**/*.spec.ts",
						"test/middleware/**/*.spec.ts",
						"test/routes/parse-cookie-samesite.spec.ts",
						"test/shared-roles.spec.ts",
					],
				},
			},
		],
	},
});
