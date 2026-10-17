import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { setOnlinePaymentProviderForTests } from "@/server/payments";
import { computeStripeSignature, StripeProvider } from "@/server/payments/stripe";
import { WebhookSignatureError, type OnlinePaymentProvider, type VerifiedCheckoutState } from "@/server/payments/types";
import { createOrder, getOrderForActor, updateOrderStatus } from "@/server/services/order-service";
import {
  handleStripeWebhook,
  markPaymentRefunded,
  recordManualPayment,
  startOnlinePayment,
  syncOnlinePayment,
} from "@/server/services/payment-service";
import { adminActor, customerActor, kitchenActor, newKey, resetDatabase, seedMenu, seedSettings } from "../support/fixtures";

const WEBHOOK_SECRET = "whsec_integration_test";

/** Real Stripe signature verification, with network calls replaced by an in-memory fake. */
class FakeStripe extends StripeProvider {
  sessions = new Map<string, VerifiedCheckoutState>();
  constructor() {
    super("sk_test_fake", WEBHOOK_SECRET, () => {
      throw new Error("network disabled in tests");
    });
  }
  override async createCheckout(params: Parameters<OnlinePaymentProvider["createCheckout"]>[0]) {
    const providerRef = `cs_test_${params.paymentId}`;
    this.sessions.set(providerRef, {
      providerRef,
      paymentId: params.paymentId,
      status: "unpaid",
      amountMinor: params.amountMinor,
      currency: params.currency,
      transactionRef: null,
    });
    return { providerRef, redirectUrl: `https://checkout.stripe.test/${providerRef}` };
  }
  override async retrieveCheckout(providerRef: string) {
    const session = this.sessions.get(providerRef);
    if (!session) throw new Error("unknown session");
    return session;
  }
}

function signedEvent(event: object) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    body,
    headers: new Headers({ "stripe-signature": `t=${timestamp},v1=${computeStripeSignature(body, timestamp, WEBHOOK_SECRET)}` }),
  };
}

function completedEvent(eventId: string, session: { id: string; paymentId: string; amount: number; currency?: string }) {
  return signedEvent({
    id: eventId,
    type: "checkout.session.completed",
    data: {
      object: {
        object: "checkout.session",
        id: session.id,
        payment_status: "paid",
        status: "complete",
        amount_total: session.amount,
        currency: (session.currency ?? "INR").toLowerCase(),
        payment_intent: `pi_${eventId}`,
        metadata: { paymentId: session.paymentId },
      },
    },
  });
}

let stripe: FakeStripe;
let menu: Awaited<ReturnType<typeof seedMenu>>;

beforeEach(async () => {
  await resetDatabase();
  await seedSettings();
  menu = await seedMenu();
  stripe = new FakeStripe();
  setOnlinePaymentProviderForTests(stripe);
});

afterEach(() => setOnlinePaymentProviderForTests(undefined));

async function onlineOrder() {
  const customer = await customerActor();
  const { orderId } = await createOrder(customer, {
    idempotencyKey: newKey(),
    items: [{ menuItemId: menu.naan.id, variantId: null, addOnIds: [], quantity: 2 }],
    type: "TAKEAWAY",
    paymentMethod: "ONLINE_CARD",
    contactName: "Online Customer",
  });
  const started = await startOnlinePayment(customer, orderId);
  const payment = await prisma.payment.findFirstOrThrow({ where: { orderId } });
  return { customer, orderId, payment, started };
}

describe("online payments", () => {
  it("never marks an order paid just because checkout started or the customer returned", async () => {
    const { customer, orderId, payment, started } = await onlineOrder();
    expect(started).toEqual({ redirectUrl: `https://checkout.stripe.test/cs_test_${payment.id}` });
    expect(payment).toMatchObject({ provider: "STRIPE", status: "PENDING", providerRef: `cs_test_${payment.id}`, amountMinor: 10_500 });
    // Customer comes back from the hosted page, but the provider says unpaid.
    expect(await syncOnlinePayment(customer, orderId)).toBe("ignored");
    expect((await getOrderForActor(customer, orderId)).paymentStatus).toBe("UNPAID");
  });

  it("marks the payment paid from a verified webhook and ignores duplicate deliveries", async () => {
    const { customer, orderId, payment } = await onlineOrder();
    const event = completedEvent("evt_paid_1", { id: payment.providerRef!, paymentId: payment.id, amount: 10_500 });
    expect(await handleStripeWebhook(event.body, event.headers)).toEqual({ duplicate: false, result: "paid" });
    expect(await handleStripeWebhook(event.body, event.headers)).toEqual({ duplicate: true, result: "unhandled" });
    // A different event id for the same session is also harmless.
    const replay = completedEvent("evt_paid_2", { id: payment.providerRef!, paymentId: payment.id, amount: 10_500 });
    expect(await handleStripeWebhook(replay.body, replay.headers)).toEqual({ duplicate: false, result: "already_paid" });

    const order = await getOrderForActor(customer, orderId);
    expect(order.paymentStatus).toBe("PAID");
    expect(order.status).toBe("PENDING"); // payment status is independent of preparation status
    expect(order.payments[0]).toMatchObject({ status: "PAID", transactionRef: "pi_evt_paid_1" });
    expect(await prisma.webhookEvent.count()).toBe(2);
  });

  it("handles the same event delivered concurrently exactly once", async () => {
    const { payment } = await onlineOrder();
    const event = completedEvent("evt_concurrent", { id: payment.providerRef!, paymentId: payment.id, amount: 10_500 });
    const results = await Promise.all([1, 2, 3].map(() => handleStripeWebhook(event.body, event.headers)));
    expect(results.filter((result) => !result.duplicate)).toHaveLength(1);
    expect(await prisma.webhookEvent.count()).toBe(1);
  });

  it("rejects webhooks with bad signatures and records nothing", async () => {
    const { payment } = await onlineOrder();
    const event = completedEvent("evt_forged", { id: payment.providerRef!, paymentId: payment.id, amount: 10_500 });
    const forged = new Headers({ "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}` });
    await expect(handleStripeWebhook(event.body, forged)).rejects.toThrow(WebhookSignatureError);
    expect(await prisma.webhookEvent.count()).toBe(0);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PENDING");
  });

  it("does not accept a payment whose amount or currency differs from the order", async () => {
    const { customer, orderId, payment } = await onlineOrder();
    const event = completedEvent("evt_short", { id: payment.providerRef!, paymentId: payment.id, amount: 100 });
    expect((await handleStripeWebhook(event.body, event.headers)).result).toBe("amount_mismatch");
    expect((await getOrderForActor(customer, orderId)).paymentStatus).toBe("UNPAID");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("FAILED");
  });

  it("confirms payment when the provider API reports it paid on return", async () => {
    const { customer, orderId, payment } = await onlineOrder();
    stripe.sessions.set(payment.providerRef!, { ...stripe.sessions.get(payment.providerRef!)!, status: "paid", transactionRef: "pi_sync" });
    expect(await syncOnlinePayment(customer, orderId)).toBe("paid");
    expect((await getOrderForActor(customer, orderId)).paymentStatus).toBe("PAID");
    await expect(syncOnlinePayment(await customerActor(), orderId)).rejects.toThrow(NotFoundError);
  });
});

describe("manual payments and refunds", () => {
  async function cashOrder() {
    const customer = await customerActor();
    const { orderId } = await createOrder(customer, {
      idempotencyKey: newKey(),
      items: [{ menuItemId: menu.naan.id, variantId: null, addOnIds: [], quantity: 1 }],
      type: "TAKEAWAY",
      paymentMethod: "CASH",
      contactName: "Cash Customer",
    });
    return { customer, orderId };
  }

  it("lets only admins record manual payments, once", async () => {
    const { orderId } = await cashOrder();
    await expect(recordManualPayment(await kitchenActor(), { orderId })).rejects.toThrow(ForbiddenError);
    await expect(recordManualPayment(await customerActor(), { orderId })).rejects.toThrow(ForbiddenError);
    const admin = await adminActor();
    await recordManualPayment(admin, { orderId, reference: "TILL-42" });
    await expect(recordManualPayment(admin, { orderId })).rejects.toThrow(ValidationError);
    const order = await getOrderForActor(admin, orderId);
    expect(order.paymentStatus).toBe("PAID");
    expect(order.payments).toHaveLength(1);
    expect(order.payments[0]).toMatchObject({ provider: "MANUAL", status: "PAID", transactionRef: "TILL-42", recordedById: admin.id });
    expect(await prisma.auditEvent.count({ where: { action: "payment.manual_record" } })).toBe(1);
  });

  it("refuses to mark cancelled orders paid and records refunds", async () => {
    const admin = await adminActor();
    const cancelled = await cashOrder();
    await updateOrderStatus(admin, { orderId: cancelled.orderId, expectedStatus: "PENDING", toStatus: "CANCELLED" });
    await expect(recordManualPayment(admin, { orderId: cancelled.orderId })).rejects.toThrow(/Cancelled/);

    const paid = await cashOrder();
    await recordManualPayment(admin, { orderId: paid.orderId });
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: paid.orderId, status: "PAID" } });
    await markPaymentRefunded(admin, { paymentId: payment.id, note: "Customer complaint" });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: paid.orderId } })).paymentStatus).toBe("REFUNDED");
    await expect(markPaymentRefunded(admin, { paymentId: payment.id })).rejects.toThrow(/Only paid/);
  });
});

describe("refund safety flags (regression)", () => {
  it("flags a second payment when cash was recorded before the online payment completed", async () => {
    const { customer, orderId, payment } = await onlineOrder();
    const admin = await adminActor();
    await recordManualPayment(admin, { orderId, reference: "TILL-7" });
    // The customer had also completed the Stripe checkout; its webhook arrives afterwards.
    const event = completedEvent("evt_late", { id: payment.providerRef!, paymentId: payment.id, amount: 10_500 });
    expect((await handleStripeWebhook(event.body, event.headers)).result).toBe("paid");

    const order = await getOrderForActor(customer, orderId);
    expect(order.payments.filter((entry) => entry.status === "PAID")).toHaveLength(2); // money received twice is recorded truthfully
    expect(await prisma.auditEvent.count({ where: { action: "payment.duplicate", entityId: orderId } })).toBe(1);
  });

  it("flags cancelled orders that were already paid", async () => {
    const { orderId, payment } = await onlineOrder();
    const event = completedEvent("evt_paid_then_cancel", { id: payment.providerRef!, paymentId: payment.id, amount: 10_500 });
    await handleStripeWebhook(event.body, event.headers);
    await updateOrderStatus(await kitchenActor(), { orderId, expectedStatus: "PENDING", toStatus: "CANCELLED", reason: "Kitchen closed" });
    const audit = await prisma.auditEvent.findFirst({ where: { action: "order.cancelled_paid", entityId: orderId } });
    expect(audit?.summary).toMatch(/refund required/);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("PAID");
  });

  it("does not flag cancellations of unpaid orders", async () => {
    const { orderId } = await onlineOrder();
    await updateOrderStatus(await kitchenActor(), { orderId, expectedStatus: "PENDING", toStatus: "CANCELLED" });
    expect(await prisma.auditEvent.count({ where: { action: "order.cancelled_paid" } })).toBe(0);
  });

  it("rejects online payment for orders with nothing to pay", async () => {
    await prisma.discountCode.create({ data: { code: "FREE", type: "PERCENT", value: 10_000 } });
    const customer = await customerActor();
    await expect(
      createOrder(customer, {
        idempotencyKey: newKey(),
        items: [{ menuItemId: menu.naan.id, variantId: null, addOnIds: [], quantity: 1 }],
        type: "TAKEAWAY",
        paymentMethod: "ONLINE_CARD",
        contactName: "Free Lunch",
        discountCode: "FREE",
      }),
    ).rejects.toThrow(/nothing to pay online/);
    expect(await prisma.order.count()).toBe(0);
    expect((await prisma.discountCode.findUniqueOrThrow({ where: { code: "FREE" } })).redemptionCount).toBe(0); // rolled back
  });
});
