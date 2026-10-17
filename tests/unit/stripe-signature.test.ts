import { describe, expect, it } from "vitest";
import { computeStripeSignature, StripeProvider, verifyStripeSignature } from "@/server/payments/stripe";
import { WebhookSignatureError } from "@/server/payments/types";

const SECRET = "whsec_unit_test_secret";
const payload = JSON.stringify({
  id: "evt_1",
  type: "checkout.session.completed",
  data: {
    object: {
      object: "checkout.session",
      id: "cs_test_123",
      payment_status: "paid",
      status: "complete",
      amount_total: 52500,
      currency: "inr",
      payment_intent: "pi_123",
      metadata: { paymentId: "pay_1" },
    },
  },
});

function header(body: string, timestamp: number, secret = SECRET) {
  return `t=${timestamp},v1=${computeStripeSignature(body, timestamp, secret)}`;
}

describe("Stripe webhook signature verification", () => {
  const now = 1_800_000_000;

  it("accepts a valid signature", () => {
    expect(() => verifyStripeSignature(payload, header(payload, now), SECRET, now)).not.toThrow();
  });

  it("rejects missing, malformed, tampered and wrong-secret signatures", () => {
    expect(() => verifyStripeSignature(payload, null, SECRET, now)).toThrow(WebhookSignatureError);
    expect(() => verifyStripeSignature(payload, "garbage", SECRET, now)).toThrow(WebhookSignatureError);
    expect(() => verifyStripeSignature(payload.replace("52500", "1"), header(payload, now), SECRET, now)).toThrow(WebhookSignatureError);
    expect(() => verifyStripeSignature(payload, header(payload, now, "whsec_other"), SECRET, now)).toThrow(WebhookSignatureError);
  });

  it("rejects replayed events outside the 5-minute tolerance", () => {
    expect(() => verifyStripeSignature(payload, header(payload, now - 301), SECRET, now)).toThrow(/tolerance/);
  });

  it("parses a verified checkout event into a provider-neutral state", () => {
    const provider = new StripeProvider("sk_test_dummy", SECRET);
    const headers = new Headers({ "stripe-signature": header(payload, Math.floor(Date.now() / 1000)) });
    const event = provider.verifyWebhook(payload, headers);
    expect(event).toEqual({
      eventId: "evt_1",
      type: "checkout.session.completed",
      checkout: {
        providerRef: "cs_test_123",
        paymentId: "pay_1",
        status: "paid",
        amountMinor: 52500,
        currency: "INR",
        transactionRef: "pi_123",
      },
    });
  });
});
