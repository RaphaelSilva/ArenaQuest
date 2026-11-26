/**
 * The Worker's app with **stub** payment adapters bound — the worker-level
 * hook for milestone 30's route specs (decision 21).
 *
 * `src/index.ts` always calls `buildContainer(env)`, which takes the
 * production factory map; nothing in `src/` can name a stub. A spec that needs
 * a provider therefore assembles the app itself, exactly as `buildApp` does
 * (`AppRouter.register` over a container), handing `buildContainer` its own
 * factory map. No production file carries a test switch.
 *
 * The container is rebuilt for every request, as the Worker rebuilds it, while
 * the stub instances — and whatever was programmed on them — outlive it.
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { buildContainer, type AppContainer } from '@api/container';
import { AppRouter } from '@api/routes';
import { stubGatewayFactories, stubPaymentsEnv, type StubGatewayAdapter } from './stub-gateway-adapter';

export interface PaymentsTestApp {
  /** The Worker env with the provider list and the stub secrets spread in. */
  env: Env;
  /** A fresh container over `env` and the stubs, for reaching a service or a repository directly. */
  container(): AppContainer;
  /** One request through a freshly built app. */
  fetch(request: Request, ctx?: ExecutionContext): Promise<Response>;
}

/**
 * @param baseEnv The spec's Worker env (`env` from `cloudflare:test`).
 * @param list A `PAYMENTS_PROVIDERS` value naming the stubs, e.g. `mercadopago:pix+card`.
 * @param stubs One stub per provider named in `list`.
 * @param overrides Extra env keys, applied last — e.g. a secret in the wrong key mode.
 */
export function buildPaymentsTestApp(
  baseEnv: Env,
  list: string,
  stubs: StubGatewayAdapter[],
  overrides: Record<string, string> = {},
): PaymentsTestApp {
  const env = { ...baseEnv, ...stubPaymentsEnv(list), ...overrides } as Env;
  const container = (): AppContainer =>
    buildContainer(env, { paymentGatewayFactories: stubGatewayFactories(...stubs) });

  return {
    env,
    container,
    async fetch(request, ctx) {
      const app = new OpenAPIHono();
      AppRouter.register(app, container());
      return app.fetch(request, env, ctx);
    },
  };
}
