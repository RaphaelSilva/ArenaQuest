import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("Worker", () => {
	it("/health returns ok (unit style)", async () => {
		const request = new IncomingRequest("http://example.com/health");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(200);
		const body = await response.json<{ status: string }>();
		expect(body.status).toBe("ok");
	});

	it("/health returns ok (integration style)", async () => {
		const response = await SELF.fetch("https://example.com/health");
		expect(response.status).toBe(200);
		const body = await response.json<{ status: string }>();
		expect(body.status).toBe("ok");
	});

	it("unknown route returns 404", async () => {
		const request = new IncomingRequest("http://example.com/unknown");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(404);
	});
});
