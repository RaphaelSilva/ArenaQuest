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
					// Force the activation flow to the in-process Console mailer so
					// integration tests never hit the real Resend API. The wrangler
					// config sets MAIL_DRIVER=resend for staging/prod parity; this
					// override only applies to the test pool.
					bindings: {
						MAIL_DRIVER: "console",
						MAIL_FROM: "ArenaQuest Test <noreply@test.local>",
						RESEND_API_KEY: "test-key-unused",
						WEB_BASE_URL: "http://localhost:3000",
					},
				},
			},
		},
	},
});
