/**
 * Online payment provider abstraction. Implementations must never handle raw
 * card data: customers pay on the provider's hosted page, and DineDesk only
 * stores provider object ids, amounts and statuses.
 */

/** Payment state as reported by the provider (trusted only after verification). */
export type VerifiedCheckoutState = {
  providerRef: string;
  /** Our Payment.id, echoed back via provider metadata. */
  paymentId: string | null;
  status: "paid" | "unpaid" | "expired" | "failed";
  amountMinor: number | null;
  currency: string | null;
  transactionRef: string | null;
};

export type VerifiedWebhookEvent = {
  eventId: string;
  type: string;
  checkout: VerifiedCheckoutState | null;
};

export type CreateCheckoutParams = {
  paymentId: string;
  orderId: string;
  description: string;
  amountMinor: number;
  currency: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
};

export interface OnlinePaymentProvider {
  readonly name: "STRIPE";
  createCheckout(params: CreateCheckoutParams): Promise<{ providerRef: string; redirectUrl: string }>;
  /** Fetches the checkout state directly from the provider API. */
  retrieveCheckout(providerRef: string): Promise<VerifiedCheckoutState>;
  /** Verifies the signature and parses a webhook. Throws WebhookSignatureError when invalid. */
  verifyWebhook(rawBody: string, headers: Headers): VerifiedWebhookEvent;
}

export class WebhookSignatureError extends Error {
  constructor(message = "Invalid webhook signature") {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

export class PaymentProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentProviderError";
  }
}
