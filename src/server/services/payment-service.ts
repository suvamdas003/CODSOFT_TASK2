import { OrderStatus, PaymentMethod, PaymentProvider, PaymentStatus } from "@/generated/prisma/enums";
import { ADMIN_ROLES, assertRole, ORDERING_ROLES, type Actor } from "@/lib/auth/permissions";
import { prisma, type Tx } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { formatOrderNumber, generateCode } from "@/lib/utils";
import { getOnlinePaymentProvider, type VerifiedCheckoutState } from "@/server/payments";
import { recordAudit } from "@/server/services/audit-service";

function appUrl(): string {
  return (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Starts (or resumes) a hosted online checkout for an unpaid order. The order
 * is only marked paid later, after the provider confirms it.
 */
export async function startOnlinePayment(actor: Actor, orderId: string): Promise<{ redirectUrl: string } | { alreadyPaid: true }> {
  assertRole(actor, ORDERING_ROLES);
  const provider = getOnlinePaymentProvider();
  if (!provider) throw new ValidationError("Online payments are not configured. Please pay at the restaurant.");

  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { payments: { orderBy: { createdAt: "desc" } } } });
  if (!order || order.customerId !== actor.id) throw new NotFoundError("Order not found.");
  if (order.paymentMethod !== PaymentMethod.ONLINE_CARD) throw new ValidationError("This order is set to be paid at the restaurant.");
  if (order.status === OrderStatus.CANCELLED) throw new ValidationError("This order was cancelled.");
  if (order.paymentStatus !== "UNPAID") return { alreadyPaid: true };

  let payment = order.payments.find(
    (candidate) => candidate.provider === PaymentProvider.STRIPE && candidate.status === PaymentStatus.PENDING,
  );

  if (payment?.providerRef) {
    const state = await provider.retrieveCheckout(payment.providerRef);
    if (state.status === "paid") {
      await prisma.$transaction((tx) => applyVerifiedCheckout(tx, state));
      return { alreadyPaid: true };
    }
    if (state.status === "expired" || state.status === "failed") {
      await prisma.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.CANCELLED, failureReason: "Checkout session expired" },
      });
      payment = undefined;
    }
  }

  if (!payment) {
    payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: PaymentProvider.STRIPE,
        method: PaymentMethod.ONLINE_CARD,
        status: PaymentStatus.PENDING,
        amountMinor: order.totalMinor,
        currency: order.currency,
      },
    });
  }

  const base = appUrl();
  const checkout = await provider.createCheckout({
    paymentId: payment.id,
    orderId: order.id,
    description: `DineDesk order ${formatOrderNumber(order.orderNumber)}`,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    customerEmail: actor.email,
    successUrl: `${base}/orders/${order.id}?payment=return&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}/orders/${order.id}?payment=cancelled`,
  });

  if (payment.providerRef !== checkout.providerRef) {
    await prisma.payment.update({ where: { id: payment.id }, data: { providerRef: checkout.providerRef } });
  }
  return { redirectUrl: checkout.redirectUrl };
}

export type ApplyResult = "paid" | "already_paid" | "marked_failed" | "ignored" | "amount_mismatch";

/**
 * Applies a provider-verified checkout state. Idempotent: applying the same
 * paid state twice leaves a single PAID payment and does nothing else.
 */
export async function applyVerifiedCheckout(tx: Tx, state: VerifiedCheckoutState): Promise<ApplyResult> {
  const payment = state.paymentId
    ? await tx.payment.findUnique({ where: { id: state.paymentId } })
    : await tx.payment.findFirst({ where: { provider: PaymentProvider.STRIPE, providerRef: state.providerRef } });

  if (!payment || payment.provider !== PaymentProvider.STRIPE) {
    logger.warn("Provider event for unknown payment", { providerRef: state.providerRef });
    return "ignored";
  }
  if (payment.providerRef && payment.providerRef !== state.providerRef) {
    logger.warn("Provider event for a superseded checkout session", { paymentId: payment.id });
    return "ignored";
  }

  if (state.status === "paid") {
    if (payment.status === PaymentStatus.PAID) return "already_paid";
    if (state.amountMinor !== payment.amountMinor || state.currency !== payment.currency) {
      await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.FAILED, failureReason: "Amount or currency mismatch — review in provider dashboard" },
      });
      logger.error("Payment amount mismatch", {
        paymentId: payment.id,
        expected: { amountMinor: payment.amountMinor, currency: payment.currency },
        received: { amountMinor: state.amountMinor, currency: state.currency },
      });
      return "amount_mismatch";
    }

    const updated = await tx.payment.updateMany({
      where: { id: payment.id, status: { not: PaymentStatus.PAID } },
      data: {
        status: PaymentStatus.PAID,
        paidAt: new Date(),
        providerRef: state.providerRef,
        transactionRef: state.transactionRef,
        failureReason: null,
      },
    });
    if (updated.count === 0) return "already_paid";

    const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId } });
    await tx.order.updateMany({ where: { id: order.id, paymentStatus: "UNPAID" }, data: { paymentStatus: "PAID" } });
    if (order.paymentStatus !== "UNPAID") {
      // Another payment (e.g. cash recorded by staff) already settled this order.
      await recordAudit(tx, {
        actorId: null,
        action: "payment.duplicate",
        entityType: "Order",
        entityId: order.id,
        summary: `Second payment received for already-paid order ${formatOrderNumber(order.orderNumber)} — refund required`,
        metadata: { paymentId: payment.id, amountMinor: payment.amountMinor },
      });
    }
    if (order.status === OrderStatus.CANCELLED) {
      await recordAudit(tx, {
        actorId: null,
        action: "payment.paid_after_cancel",
        entityType: "Order",
        entityId: order.id,
        summary: `Online payment received for cancelled order ${formatOrderNumber(order.orderNumber)} — refund required`,
      });
    }
    return "paid";
  }

  if ((state.status === "expired" || state.status === "failed") && payment.status === PaymentStatus.PENDING) {
    await tx.payment.updateMany({
      where: { id: payment.id, status: PaymentStatus.PENDING },
      data: {
        status: state.status === "failed" ? PaymentStatus.FAILED : PaymentStatus.CANCELLED,
        failureReason: state.status === "failed" ? "Payment failed at provider" : "Checkout session expired",
      },
    });
    return "marked_failed";
  }
  return "ignored";
}

const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
]);

/**
 * Processes a provider webhook. The signature is verified first; the event id
 * is recorded in the same transaction as its effects, so repeated deliveries
 * are acknowledged without being applied twice.
 */
export async function handleStripeWebhook(
  rawBody: string,
  headers: Headers,
): Promise<{ duplicate: boolean; result: ApplyResult | "unhandled" }> {
  const provider = getOnlinePaymentProvider();
  if (!provider) throw new ValidationError("Online payments are not configured.");
  const event = provider.verifyWebhook(rawBody, headers);

  return prisma.$transaction(async (tx) => {
    const inserted = await tx.$executeRaw`
      INSERT INTO "webhook_events" ("id", "provider", "eventId", "type", "processedAt")
      VALUES (${`whe_${generateCode(20)}`}, 'STRIPE'::"PaymentProvider", ${event.eventId}, ${event.type}, NOW())
      ON CONFLICT ("provider", "eventId") DO NOTHING`;
    if (inserted === 0) return { duplicate: true, result: "unhandled" as const };
    if (!HANDLED_EVENTS.has(event.type) || !event.checkout) return { duplicate: false, result: "unhandled" as const };
    const result = await applyVerifiedCheckout(tx, event.checkout);
    return { duplicate: false, result };
  });
}

/**
 * Called when a customer returns from the hosted checkout: asks the provider
 * for the real state instead of trusting the redirect.
 */
export async function syncOnlinePayment(actor: Actor, orderId: string): Promise<ApplyResult | "not_applicable"> {
  assertRole(actor, ORDERING_ROLES);
  const provider = getOnlinePaymentProvider();
  if (!provider) return "not_applicable";
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payments: { where: { provider: PaymentProvider.STRIPE, status: PaymentStatus.PENDING, providerRef: { not: null } } } },
  });
  if (!order || order.customerId !== actor.id) throw new NotFoundError("Order not found.");
  const payment = order.payments[0];
  if (!payment?.providerRef) return "not_applicable";
  const state = await provider.retrieveCheckout(payment.providerRef);
  return prisma.$transaction((tx) => applyVerifiedCheckout(tx, state));
}

/** Staff records a cash/manual payment taken at the counter. Clearly labelled as manual. */
export async function recordManualPayment(actor: Actor, input: { orderId: string; reference?: string }) {
  assertRole(actor, ADMIN_ROLES);
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: input.orderId }, include: { payments: true } });
    if (!order) throw new NotFoundError("Order not found.");
    if (order.paymentStatus !== "UNPAID") throw new ValidationError("This order is already marked as paid.");
    if (order.status === OrderStatus.CANCELLED) throw new ValidationError("Cancelled orders cannot be marked as paid.");

    const flipped = await tx.order.updateMany({ where: { id: order.id, paymentStatus: "UNPAID" }, data: { paymentStatus: "PAID" } });
    if (flipped.count === 0) throw new ConflictError("This order was just marked as paid by someone else.");

    const reference = input.reference || `CASH-${generateCode(8)}`;
    const pendingManual = order.payments.find(
      (payment) => payment.provider === PaymentProvider.MANUAL && payment.status === PaymentStatus.PENDING,
    );
    const now = new Date();
    if (pendingManual) {
      await tx.payment.update({
        where: { id: pendingManual.id },
        data: { status: PaymentStatus.PAID, paidAt: now, transactionRef: reference, recordedById: actor.id },
      });
    } else {
      await tx.payment.create({
        data: {
          orderId: order.id,
          provider: PaymentProvider.MANUAL,
          method: PaymentMethod.CASH,
          status: PaymentStatus.PAID,
          amountMinor: order.totalMinor,
          currency: order.currency,
          transactionRef: reference,
          recordedById: actor.id,
          paidAt: now,
        },
      });
    }
    // Any open online checkout is no longer needed.
    await tx.payment.updateMany({
      where: { orderId: order.id, provider: PaymentProvider.STRIPE, status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.CANCELLED, failureReason: "Paid manually at the restaurant" },
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "payment.manual_record",
      entityType: "Order",
      entityId: order.id,
      summary: `Recorded manual payment for ${formatOrderNumber(order.orderNumber)} (${reference})`,
      metadata: { amountMinor: order.totalMinor, currency: order.currency },
    });
  });
}

/**
 * Records that a payment was refunded. For online payments the refund itself
 * must be issued in the provider dashboard; this keeps DineDesk's records in sync.
 */
export async function markPaymentRefunded(actor: Actor, input: { paymentId: string; note?: string }) {
  assertRole(actor, ADMIN_ROLES);
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: input.paymentId }, include: { order: true } });
    if (!payment) throw new NotFoundError("Payment not found.");
    const updated = await tx.payment.updateMany({
      where: { id: payment.id, status: PaymentStatus.PAID },
      data: { status: PaymentStatus.REFUNDED, refundedAt: new Date(), failureReason: input.note ?? null },
    });
    if (updated.count === 0) throw new ValidationError("Only paid payments can be marked as refunded.");
    const stillPaid = await tx.payment.count({ where: { orderId: payment.orderId, status: PaymentStatus.PAID } });
    if (stillPaid === 0) await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: "REFUNDED" } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "payment.refund_record",
      entityType: "Payment",
      entityId: payment.id,
      summary: `Marked payment for ${formatOrderNumber(payment.order.orderNumber)} as refunded`,
      metadata: { provider: payment.provider, amountMinor: payment.amountMinor, note: input.note ?? null },
    });
  });
}
