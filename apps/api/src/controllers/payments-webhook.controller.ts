import type { PaymentProviderName } from '@arenaquest/shared/ports/i-payment-gateway';
import { isPaymentProviderName } from '@arenaquest/shared/domain/billing/gateway-money';
import { PAYMENTS_CONFIG_INVALID, type PaymentsConfigResult } from '@api/core/payments/config';
import type { GatewayRegistry } from '@api/core/payments/gateway-registry';
import type { GatewayHandleOutcome, GatewayService } from '@api/core/payments/gateway-service';
import type { ControllerResult } from '@api/core/result';

/**
 * The payment webhook (RFC 0026 §4) past the meter: which provider, is the
 * delivery authentic, and what did processing it come to.
 *
 * The order below is the contract. The body is read **once**, and only after
 * the provider resolved and the configuration checked out — a delivery for a
 * provider this label does not bind costs no read and no signature check. A
 * delivery that fails verification writes nothing and logs nothing of itself.
 *
 * This controller never learns who is calling: the surface has no user, only
 * a signature.
 */

/** A provider's events are a few KiB; anything above this is not one. */
export const WEBHOOK_MAX_BODY_BYTES = 64 * 1024;

/** The error code of the `503` that asks the provider to deliver again. */
export const PAYMENTS_EVENT_FAILED = 'PAYMENTS_EVENT_FAILED';

/** `200`: what the delivery came to. `failed` is never a `200` — it is the `503`. */
export interface PaymentsWebhookAck {
  outcome: Exclude<GatewayHandleOutcome, 'failed'>;
}

export interface PaymentsWebhookDelivery {
  /** The `{provider}` path segment, as received. */
  provider: string;
  /** Reads the raw body; called at most once, and only when the delivery will be verified. */
  readBody: () => Promise<string>;
  /** The request headers, names lower-cased. */
  headers: Readonly<Record<string, string>>;
  /** The URL's query parameters, first value wins. */
  query: Readonly<Record<string, string>>;
}

function failure(status: number, error: string): ControllerResult<never> {
  return { ok: false, status, error };
}

export class PaymentsWebhookController {
  constructor(
    private readonly config: PaymentsConfigResult,
    private readonly gateways: Pick<GatewayRegistry, 'get'>,
    private readonly service: Pick<GatewayService, 'handleEvent'>,
  ) {}

  async receive(delivery: PaymentsWebhookDelivery): Promise<ControllerResult<PaymentsWebhookAck>> {
    // A name the platform does not know is never a configuration problem.
    if (!isPaymentProviderName(delivery.provider)) return failure(404, 'NotFound');

    // An invalid list binds nothing, so this must be asked before the
    // registry: the failure is loud here rather than a quiet 404.
    if (!this.config.ok) {
      console.error(
        JSON.stringify({ event: 'payments.config_invalid', reason: this.config.reason, detail: this.config.detail }),
      );
      return failure(500, PAYMENTS_CONFIG_INVALID);
    }

    const provider: PaymentProviderName = delivery.provider;
    const gateway = this.gateways.get(provider);
    if (!gateway) return failure(404, 'NotFound');

    const rawBody = await delivery.readBody();
    // A body that declared no length (or lied about it) is still bounded.
    if (new TextEncoder().encode(rawBody).byteLength > WEBHOOK_MAX_BODY_BYTES) {
      return failure(413, 'PayloadTooLarge');
    }

    const event = await gateway.verifyWebhook(rawBody, delivery.headers, delivery.query);
    if (!event) {
      // One counter line: the provider's name and nothing from the delivery.
      console.warn(JSON.stringify({ event: 'payments.webhook_rejected', provider }));
      return failure(401, 'Unauthorized');
    }

    const handled = await this.service.handleEvent(provider, event);
    if (handled.outcome === 'failed') return failure(503, PAYMENTS_EVENT_FAILED);
    return { ok: true, data: { outcome: handled.outcome } };
  }
}
