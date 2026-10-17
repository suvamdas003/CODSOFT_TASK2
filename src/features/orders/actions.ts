"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { getActor, getCurrentUser } from "@/lib/auth/session";
import { clientIpFromHeaders } from "@/lib/client-ip";
import { parseInput, runAction, type ActionResult } from "@/lib/action";
import { logger } from "@/lib/logger";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { idSchema } from "@/lib/validation/common";
import { checkoutSchema, orderStatusUpdateSchema, quoteSchema } from "@/lib/validation/order";
import { cancelOwnOrder, createOrder, quoteCart, updateOrderStatus, type Quote } from "@/server/services/order-service";
import { startOnlinePayment, syncOnlinePayment } from "@/server/services/payment-service";

/** Server-side price check for the cart page. Public: menu prices are public. */
export async function quoteCartAction(input: unknown): Promise<ActionResult<Quote>> {
  return runAction("quoteCart", async () => {
    const user = await getCurrentUser();
    enforceRateLimit(`quote:${user?.id ?? `ip:${clientIpFromHeaders(await headers())}`}`, RATE_LIMITS.quote);
    const parsed = parseInput(quoteSchema, input);
    return quoteCart(parsed);
  });
}

export type PlaceOrderResult = { orderId: string; redirectUrl?: string; paymentError?: string };

export async function placeOrderAction(input: unknown): Promise<ActionResult<PlaceOrderResult>> {
  return runAction("placeOrder", async () => {
    const actor = await getActor(["CUSTOMER", "ADMIN"]);
    enforceRateLimit(`order:${actor.id}`, RATE_LIMITS.placeOrder);
    const parsed = parseInput(checkoutSchema, input);
    const { orderId } = await createOrder(actor, parsed);
    revalidatePath("/orders");

    if (parsed.paymentMethod === "ONLINE_CARD") {
      try {
        const payment = await startOnlinePayment(actor, orderId);
        if ("redirectUrl" in payment) return { orderId, redirectUrl: payment.redirectUrl };
      } catch (error) {
        logger.error("Could not start online payment", { orderId, error });
        return {
          orderId,
          paymentError: "Your order was placed, but the payment page could not be opened. You can retry from the order page.",
        };
      }
    }
    return { orderId };
  });
}

export async function cancelOrderAction(orderId: string): Promise<ActionResult> {
  return runAction(
    "cancelOrder",
    async () => {
      const actor = await getActor(["CUSTOMER", "ADMIN"]);
      await cancelOwnOrder(actor, parseInput(idSchema, orderId));
      revalidatePath(`/orders/${orderId}`);
      revalidatePath("/orders");
      return null;
    },
    "Your order has been cancelled.",
  );
}

export async function payOnlineAction(orderId: string): Promise<ActionResult<{ redirectUrl?: string }>> {
  return runAction("payOnline", async () => {
    const actor = await getActor(["CUSTOMER", "ADMIN"]);
    enforceRateLimit(`payment:${actor.id}`, RATE_LIMITS.payment);
    const result = await startOnlinePayment(actor, parseInput(idSchema, orderId));
    revalidatePath(`/orders/${orderId}`);
    return "redirectUrl" in result ? { redirectUrl: result.redirectUrl } : {};
  });
}

export async function syncPaymentAction(orderId: string): Promise<ActionResult<{ result: string }>> {
  return runAction("syncPayment", async () => {
    const actor = await getActor(["CUSTOMER", "ADMIN"]);
    enforceRateLimit(`payment:${actor.id}`, RATE_LIMITS.payment);
    const result = await syncOnlinePayment(actor, parseInput(idSchema, orderId));
    revalidatePath(`/orders/${orderId}`);
    return { result };
  });
}

/** Kitchen/admin status change with optimistic concurrency (expectedStatus). */
export async function updateOrderStatusAction(input: z.input<typeof orderStatusUpdateSchema>): Promise<ActionResult> {
  return runAction("updateOrderStatus", async () => {
    const actor = await getActor(["KITCHEN_STAFF", "ADMIN"]);
    const parsed = parseInput(orderStatusUpdateSchema, input);
    await updateOrderStatus(actor, parsed);
    revalidatePath("/kitchen");
    revalidatePath(`/admin/orders/${parsed.orderId}`);
    return null;
  });
}
