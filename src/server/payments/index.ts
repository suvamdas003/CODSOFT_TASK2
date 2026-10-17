import { StripeProvider } from "@/server/payments/stripe";
import type { OnlinePaymentProvider } from "@/server/payments/types";

let override: OnlinePaymentProvider | null | undefined;

/**
 * Returns the configured online payment provider, or null when online
 * payments are not configured (cash/manual payments keep working).
 */
export function getOnlinePaymentProvider(): OnlinePaymentProvider | null {
  if (override !== undefined) return override;
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secretKey || !webhookSecret) return null;
  return new StripeProvider(secretKey, webhookSecret);
}

/** Test hook: inject a fake provider (pass undefined to restore env-based config). */
export function setOnlinePaymentProviderForTests(provider: OnlinePaymentProvider | null | undefined) {
  override = provider;
}

export function isStripeTestMode(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_test_");
}

export * from "@/server/payments/types";
