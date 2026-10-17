import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { getOnlinePaymentProvider, WebhookSignatureError } from "@/server/payments";
import { handleStripeWebhook } from "@/server/services/payment-service";

const MAX_BODY_BYTES = 256 * 1024;

/**
 * Stripe webhook receiver. Authenticated by the Stripe-Signature HMAC (not by
 * cookies), so it is exempt from session auth and CSRF checks by design.
 * Repeated deliveries of the same event id are acknowledged idempotently.
 */
export async function POST(request: Request) {
  if (!getOnlinePaymentProvider()) {
    return NextResponse.json({ error: "Online payments are not configured" }, { status: 503 });
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });

  try {
    const outcome = await handleStripeWebhook(rawBody, request.headers);
    return NextResponse.json({ received: true, duplicate: outcome.duplicate, result: outcome.result });
  } catch (error) {
    if (error instanceof WebhookSignatureError) {
      logger.warn("Rejected Stripe webhook", { reason: error.message });
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
    // 5xx makes Stripe retry later; the event id was not recorded (transaction rolled back).
    logger.error("Stripe webhook processing failed", { error });
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
