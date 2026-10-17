import { createHmac, timingSafeEqual } from "node:crypto";
import {
  PaymentProviderError,
  WebhookSignatureError,
  type CreateCheckoutParams,
  type OnlinePaymentProvider,
  type VerifiedCheckoutState,
  type VerifiedWebhookEvent,
} from "@/server/payments/types";

const STRIPE_API = "https://api.stripe.com/v1";
const SIGNATURE_TOLERANCE_SECONDS = 300;

type StripeCheckoutSession = {
  id: string;
  url?: string | null;
  status?: "open" | "complete" | "expired" | null;
  payment_status?: "paid" | "unpaid" | "no_payment_required";
  amount_total?: number | null;
  currency?: string | null;
  payment_intent?: string | { id: string } | null;
  metadata?: Record<string, string> | null;
  client_reference_id?: string | null;
};

/**
 * Computes the Stripe webhook signature: HMAC-SHA256 of `${timestamp}.${payload}`.
 * Exported for tests.
 */
export function computeStripeSignature(payload: string, timestamp: number, secret: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${payload}`, "utf8").digest("hex");
}

/** Verifies a `Stripe-Signature` header (t=…,v1=…) in constant time with a replay window. */
export function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  if (!header) throw new WebhookSignatureError("Missing Stripe-Signature header");
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2).map((piece) => piece?.trim());
    if (key === "t" && value) timestamp = Number(value);
    if (key === "v1" && value) signatures.push(value);
  }
  if (timestamp === null || !Number.isFinite(timestamp) || signatures.length === 0) {
    throw new WebhookSignatureError("Malformed Stripe-Signature header");
  }
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    throw new WebhookSignatureError("Webhook timestamp outside tolerance");
  }
  const expected = Buffer.from(computeStripeSignature(payload, timestamp, secret), "hex");
  const matches = signatures.some((signature) => {
    const candidate = Buffer.from(signature, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
  if (!matches) throw new WebhookSignatureError("Signature mismatch");
}

function toCheckoutState(session: StripeCheckoutSession): VerifiedCheckoutState {
  let status: VerifiedCheckoutState["status"] = "unpaid";
  if (session.payment_status === "paid") status = "paid";
  else if (session.status === "expired") status = "expired";
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
  return {
    providerRef: session.id,
    paymentId: session.metadata?.paymentId ?? session.client_reference_id ?? null,
    status,
    amountMinor: typeof session.amount_total === "number" ? session.amount_total : null,
    currency: session.currency ? session.currency.toUpperCase() : null,
    transactionRef: paymentIntent,
  };
}

export class StripeProvider implements OnlinePaymentProvider {
  readonly name = "STRIPE" as const;

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(method: "GET" | "POST", path: string, body?: URLSearchParams, idempotencyKey?: string): Promise<T> {
    const response = await this.fetchImpl(`${STRIPE_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body,
      cache: "no-store",
    });
    const json = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
    if (!response.ok || !json) {
      // Provider messages can be shown to admins in logs, never secrets.
      throw new PaymentProviderError(json?.error?.message ?? `Stripe request failed with status ${response.status}`);
    }
    return json;
  }

  async createCheckout(params: CreateCheckoutParams) {
    const body = new URLSearchParams({
      mode: "payment",
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      client_reference_id: params.paymentId,
      customer_email: params.customerEmail,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": params.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(params.amountMinor),
      "line_items[0][price_data][product_data][name]": params.description,
      "metadata[paymentId]": params.paymentId,
      "metadata[orderId]": params.orderId,
      "payment_intent_data[metadata][paymentId]": params.paymentId,
    });
    const session = await this.request<StripeCheckoutSession>("POST", "/checkout/sessions", body, `dinedesk-checkout-${params.paymentId}`);
    if (!session.url) throw new PaymentProviderError("Stripe did not return a checkout URL");
    return { providerRef: session.id, redirectUrl: session.url };
  }

  async retrieveCheckout(providerRef: string) {
    if (!/^cs_[A-Za-z0-9_]+$/.test(providerRef)) throw new PaymentProviderError("Invalid checkout session id");
    const session = await this.request<StripeCheckoutSession>("GET", `/checkout/sessions/${providerRef}`);
    return toCheckoutState(session);
  }

  verifyWebhook(rawBody: string, headers: Headers): VerifiedWebhookEvent {
    verifyStripeSignature(rawBody, headers.get("stripe-signature"), this.webhookSecret);
    let event: { id?: string; type?: string; data?: { object?: StripeCheckoutSession & { object?: string } } };
    try {
      event = JSON.parse(rawBody);
    } catch {
      throw new WebhookSignatureError("Invalid JSON payload");
    }
    if (!event.id || !event.type) throw new WebhookSignatureError("Malformed event");
    const object = event.data?.object;
    const isCheckout = object?.object === "checkout.session" || event.type.startsWith("checkout.session.");
    let checkout = isCheckout && object ? toCheckoutState(object) : null;
    if (checkout && event.type === "checkout.session.async_payment_failed") checkout = { ...checkout, status: "failed" };
    return { eventId: event.id, type: event.type, checkout };
  }
}
