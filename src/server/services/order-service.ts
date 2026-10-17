import { OrderStatus, OrderType, PaymentMethod, PaymentProvider, PaymentStatus, Role } from "@/generated/prisma/enums";
import { assertRole, canAccessOwnedRecord, KITCHEN_ROLES, ORDERING_ROLES, type Actor } from "@/lib/auth/permissions";
import { isUniqueViolation, prisma, type Db, type Prisma, type Tx } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { zonedDayRange } from "@/lib/time";
import { formatOrderNumber, humanize } from "@/lib/utils";
/** Cart line as validated by cartLineSchema (ids and quantities only — never prices). */
export type CartLine = { menuItemId: string; variantId: string | null; addOnIds: string[]; quantity: number; notes?: string };
import { getOnlinePaymentProvider } from "@/server/payments";
import { getSettings } from "@/server/repositories/settings-repository";
import { recordAudit } from "@/server/services/audit-service";
import { ACTIVE_ORDER_STATUSES, canTransition, isWithinCancelWindow, STATUS_TIMESTAMP_FIELD } from "@/server/services/order-status";
import { computeDiscount, computeTotals, lineTotal, unitPrice, type DiscountRule, type Totals } from "@/server/services/pricing";

// ─── Cart resolution (trusted prices from the database) ────────────────────

export type ResolvedLine = {
  menuItemId: string;
  name: string;
  variantId: string | null;
  variantName: string | null;
  addOns: { id: string; name: string; priceMinor: number }[];
  basePriceMinor: number;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
  notes: string | null;
};

export type CartIssue = { index: number; menuItemId: string; message: string };

/**
 * Re-prices a cart from the database. Client-supplied prices are never used:
 * only ids and quantities are trusted, and every item, variant and add-on is
 * checked for existence, publication and availability.
 */
export async function resolveCart(db: Db, lines: CartLine[]): Promise<{ lines: ResolvedLine[]; issues: CartIssue[] }> {
  const ids = [...new Set(lines.map((line) => line.menuItemId))];
  const items = await db.menuItem.findMany({
    where: { id: { in: ids } },
    include: { category: { select: { isActive: true } }, variants: true, addOns: true },
  });
  const byId = new Map(items.map((item) => [item.id, item]));

  const resolved: ResolvedLine[] = [];
  const issues: CartIssue[] = [];

  lines.forEach((line, index) => {
    const item = byId.get(line.menuItemId);
    const issue = (message: string) => issues.push({ index, menuItemId: line.menuItemId, message });

    if (!item || item.archivedAt || !item.isPublished || !item.category.isActive) {
      issue("An item in your cart is no longer on the menu. Please remove it.");
      return;
    }
    const availableVariants = item.variants.filter((variant) => variant.isAvailable);
    if (!item.isAvailable || (item.variants.length > 0 && availableVariants.length === 0)) {
      issue(`“${item.name}” is sold out right now. Please remove it to continue.`);
      return;
    }

    let variant: (typeof item.variants)[number] | null = null;
    if (line.variantId) {
      variant = item.variants.find((candidate) => candidate.id === line.variantId) ?? null;
      if (!variant) {
        issue(`The selected option for “${item.name}” is no longer offered. Please re-add the item.`);
        return;
      }
      if (!variant.isAvailable) {
        issue(`“${item.name} – ${variant.name}” is unavailable. Please choose another option.`);
        return;
      }
    } else if (availableVariants.length > 0) {
      issue(`Please choose an option for “${item.name}”.`);
      return;
    }

    const addOns: ResolvedLine["addOns"] = [];
    for (const addOnId of line.addOnIds) {
      const addOn = item.addOns.find((candidate) => candidate.id === addOnId);
      if (!addOn) {
        issue(`An extra selected for “${item.name}” is no longer offered. Please re-add the item.`);
        return;
      }
      if (!addOn.isAvailable) {
        issue(`The extra “${addOn.name}” for “${item.name}” is unavailable. Please re-add the item without it.`);
        return;
      }
      addOns.push({ id: addOn.id, name: addOn.name, priceMinor: addOn.priceMinor });
    }

    const unit = unitPrice(
      item.priceMinor,
      variant?.priceDeltaMinor ?? 0,
      addOns.map((addOn) => addOn.priceMinor),
    );
    resolved.push({
      menuItemId: item.id,
      name: item.name,
      variantId: variant?.id ?? null,
      variantName: variant?.name ?? null,
      addOns,
      basePriceMinor: item.priceMinor,
      unitPriceMinor: unit,
      quantity: line.quantity,
      lineTotalMinor: lineTotal(unit, line.quantity),
      notes: line.notes ?? null,
    });
  });

  return { lines: resolved, issues };
}

// ─── Discounts ──────────────────────────────────────────────────────────────

type DiscountLookup = { ok: true; id: string; code: string; rule: DiscountRule } | { ok: false; message: string };

export async function lookupDiscount(db: Db, code: string, subtotalMinor: number, now = new Date()): Promise<DiscountLookup> {
  const discount = await db.discountCode.findUnique({ where: { code: code.toUpperCase() } });
  if (!discount || !discount.isActive) return { ok: false, message: "This discount code is not valid." };
  if (discount.startsAt && discount.startsAt > now) return { ok: false, message: "This discount code is not active yet." };
  if (discount.endsAt && discount.endsAt < now) return { ok: false, message: "This discount code has expired." };
  if (discount.maxRedemptions !== null && discount.redemptionCount >= discount.maxRedemptions) {
    return { ok: false, message: "This discount code has reached its usage limit." };
  }
  if (subtotalMinor < discount.minSubtotalMinor) {
    return { ok: false, message: "Your order does not meet the minimum amount for this code." };
  }
  return {
    ok: true,
    id: discount.id,
    code: discount.code,
    rule: {
      type: discount.type,
      value: discount.value,
      minSubtotalMinor: discount.minSubtotalMinor,
      maxDiscountMinor: discount.maxDiscountMinor,
    },
  };
}

/** Atomically consumes one redemption; returns false if the limit was reached concurrently. */
async function redeemDiscount(tx: Tx, discountId: string): Promise<boolean> {
  const updated = await tx.$executeRaw`
    UPDATE "discount_codes"
       SET "redemptionCount" = "redemptionCount" + 1, "updatedAt" = NOW()
     WHERE "id" = ${discountId}
       AND "isActive" = true
       AND ("maxRedemptions" IS NULL OR "redemptionCount" < "maxRedemptions")`;
  return updated === 1;
}

// ─── Quotes ─────────────────────────────────────────────────────────────────

export type Quote = {
  lines: ResolvedLine[];
  issues: CartIssue[];
  totals: Totals;
  currency: string;
  discountCode: string | null;
  discountMessage: string | null;
};

/** Server-side price preview for the cart page (no side effects). */
export async function quoteCart(input: { items: CartLine[]; type: OrderType; discountCode?: string }): Promise<Quote> {
  const settings = await getSettings();
  const { lines, issues } = await resolveCart(prisma, input.items);
  const subtotalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);

  let discountMinor = 0;
  let discountMessage: string | null = null;
  let discountCode: string | null = null;
  if (input.discountCode) {
    const lookup = await lookupDiscount(prisma, input.discountCode, subtotalMinor);
    if (lookup.ok) {
      discountMinor = computeDiscount(subtotalMinor, lookup.rule);
      discountCode = lookup.code;
    } else {
      discountMessage = lookup.message;
    }
  }

  const totals = computeTotals({ subtotalMinor, discountMinor, orderType: input.type, settings });
  return { lines, issues, totals, currency: settings.currency, discountCode, discountMessage };
}

// ─── Order creation ─────────────────────────────────────────────────────────

export type CreateOrderInput = {
  idempotencyKey: string;
  items: CartLine[];
  type: OrderType;
  paymentMethod: PaymentMethod;
  contactName: string;
  contactPhone?: string;
  deliveryAddress?: string;
  tableId?: string;
  notes?: string;
  discountCode?: string;
};

/**
 * Creates an order atomically with item snapshots, status history and a
 * pending payment record. Repeated submissions with the same idempotency key
 * return the original order instead of creating a duplicate.
 */
export async function createOrder(actor: Actor, input: CreateOrderInput): Promise<{ orderId: string; created: boolean }> {
  assertRole(actor, ORDERING_ROLES);

  const existing = await prisma.order.findUnique({
    where: { customerId_idempotencyKey: { customerId: actor.id, idempotencyKey: input.idempotencyKey } },
    select: { id: true },
  });
  if (existing) return { orderId: existing.id, created: false };

  const settings = await getSettings();
  if (!settings.acceptingOrders) throw new ValidationError("We are not accepting online orders right now. Please try again later.");
  if (!settings.enabledOrderTypes.includes(input.type)) {
    throw new ValidationError(`${humanize(input.type)} orders are not available.`, { type: ["This order type is not available."] });
  }
  if (!settings.enabledPaymentMethods.includes(input.paymentMethod)) {
    throw new ValidationError("This payment method is not available.", { paymentMethod: ["Not available."] });
  }
  if (input.paymentMethod === PaymentMethod.ONLINE_CARD && !getOnlinePaymentProvider()) {
    throw new ValidationError("Online card payments are not configured. Please choose another payment method.", {
      paymentMethod: ["Online payments are not configured."],
    });
  }
  if (input.type === OrderType.DELIVERY && (!input.deliveryAddress || !input.contactPhone)) {
    throw new ValidationError("Delivery orders need an address and phone number.");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const { lines, issues } = await resolveCart(tx, input.items);
      if (issues.length) {
        throw new ValidationError(issues[0].message, { items: issues.map((issue) => issue.message) });
      }
      if (!lines.length) throw new ValidationError("Your cart is empty.");

      const subtotalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);

      let discountMinor = 0;
      let discountCode: string | null = null;
      if (input.discountCode) {
        const lookup = await lookupDiscount(tx, input.discountCode, subtotalMinor);
        if (!lookup.ok) throw new ValidationError(lookup.message, { discountCode: [lookup.message] });
        if (!(await redeemDiscount(tx, lookup.id))) {
          throw new ValidationError("This discount code has reached its usage limit.", { discountCode: ["Usage limit reached."] });
        }
        discountMinor = computeDiscount(subtotalMinor, lookup.rule);
        discountCode = lookup.code;
      }

      let tableId: string | null = null;
      if (input.type === OrderType.DINE_IN && input.tableId) {
        const table = await tx.restaurantTable.findFirst({ where: { id: input.tableId, isActive: true }, select: { id: true } });
        if (!table) throw new ValidationError("Choose a valid table.", { tableId: ["Choose a valid table."] });
        tableId = table.id;
      }

      const totals = computeTotals({ subtotalMinor, discountMinor, orderType: input.type, settings });
      if (input.paymentMethod === PaymentMethod.ONLINE_CARD && totals.totalMinor <= 0) {
        throw new ValidationError("This order has nothing to pay online. Please choose to pay at the restaurant.", {
          paymentMethod: ["Nothing to pay online."],
        });
      }

      const order = await tx.order.create({
        data: {
          customerId: actor.id,
          idempotencyKey: input.idempotencyKey,
          type: input.type,
          paymentMethod: input.paymentMethod,
          tableId,
          contactName: input.contactName,
          contactPhone: input.contactPhone ?? null,
          deliveryAddress: input.type === OrderType.DELIVERY ? (input.deliveryAddress ?? null) : null,
          notes: input.notes ?? null,
          currency: settings.currency,
          ...totals,
          taxRateBps: settings.taxRateBps,
          serviceChargeBps: input.type === OrderType.DINE_IN ? settings.serviceChargeBps : 0,
          discountCode,
          items: {
            create: lines.map((line) => ({
              menuItemId: line.menuItemId,
              nameSnapshot: line.name,
              variantName: line.variantName,
              addOns: line.addOns.map(({ name, priceMinor }) => ({ name, priceMinor })),
              basePriceMinor: line.basePriceMinor,
              unitPriceMinor: line.unitPriceMinor,
              quantity: line.quantity,
              lineTotalMinor: line.lineTotalMinor,
              notes: line.notes,
            })),
          },
          statusEvents: { create: { toStatus: OrderStatus.PENDING, actorId: actor.id, note: "Order placed" } },
          payments: {
            create: {
              provider: input.paymentMethod === PaymentMethod.CASH ? PaymentProvider.MANUAL : PaymentProvider.STRIPE,
              method: input.paymentMethod,
              status: PaymentStatus.PENDING,
              amountMinor: totals.totalMinor,
              currency: settings.currency,
            },
          },
        },
        select: { id: true },
      });
      return { orderId: order.id, created: true };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // A concurrent request with the same idempotency key won the race.
      const winner = await prisma.order.findUnique({
        where: { customerId_idempotencyKey: { customerId: actor.id, idempotencyKey: input.idempotencyKey } },
        select: { id: true },
      });
      if (winner) return { orderId: winner.id, created: false };
    }
    throw error;
  }
}

// ─── Status changes ─────────────────────────────────────────────────────────

async function applyStatusChange(
  tx: Tx,
  params: { orderId: string; from: OrderStatus; to: OrderStatus; actorId: string; reason?: string; extraWhere?: Prisma.OrderWhereInput },
) {
  const now = new Date();
  const data: Prisma.OrderUpdateManyMutationInput = { status: params.to };
  const timestampField = STATUS_TIMESTAMP_FIELD[params.to];
  if (timestampField) data[timestampField] = now;
  if (params.to === OrderStatus.CANCELLED) data.cancelReason = params.reason ?? null;

  // Optimistic concurrency: only succeeds if nobody changed the status meanwhile.
  const result = await tx.order.updateMany({
    where: { id: params.orderId, status: params.from, ...params.extraWhere },
    data,
  });
  if (result.count === 0) {
    const current = await tx.order.findUnique({ where: { id: params.orderId }, select: { status: true } });
    if (!current) throw new NotFoundError("Order not found.");
    if (current.status === params.to) throw new ConflictError(`This order is already ${humanize(current.status).toLowerCase()}.`);
    throw new ConflictError(`This order is now ${humanize(current.status).toLowerCase()}. Please refresh.`);
  }

  await tx.orderStatusEvent.create({
    data: { orderId: params.orderId, fromStatus: params.from, toStatus: params.to, actorId: params.actorId, note: params.reason ?? null },
  });

  if (params.to === OrderStatus.CANCELLED) {
    await tx.payment.updateMany({
      where: { orderId: params.orderId, status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.CANCELLED, failureReason: "Order cancelled" },
    });
    // Money already taken for a cancelled order must be refunded by staff: flag it.
    const order = await tx.order.findUniqueOrThrow({ where: { id: params.orderId }, select: { orderNumber: true, paymentStatus: true } });
    if (order.paymentStatus === "PAID") {
      await recordAudit(tx, {
        actorId: params.actorId,
        action: "order.cancelled_paid",
        entityType: "Order",
        entityId: params.orderId,
        summary: `Paid order ${formatOrderNumber(order.orderNumber)} was cancelled — refund required`,
      });
    }
  }
}

/** Kitchen/admin status update with role-aware transition rules. */
export async function updateOrderStatus(
  actor: Actor,
  input: { orderId: string; expectedStatus: OrderStatus; toStatus: OrderStatus; reason?: string },
) {
  assertRole(actor, KITCHEN_ROLES);
  if (!canTransition(actor.role, input.expectedStatus, input.toStatus)) {
    throw new ForbiddenError(
      `Changing an order from ${humanize(input.expectedStatus).toLowerCase()} to ${humanize(input.toStatus).toLowerCase()} is not allowed.`,
    );
  }
  await prisma.$transaction(async (tx) => {
    await applyStatusChange(tx, {
      orderId: input.orderId,
      from: input.expectedStatus,
      to: input.toStatus,
      actorId: actor.id,
      reason: input.reason,
    });
    if (actor.role === Role.ADMIN) {
      const order = await tx.order.findUnique({ where: { id: input.orderId }, select: { orderNumber: true } });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "order.status",
        entityType: "Order",
        entityId: input.orderId,
        summary: `Order ${order ? formatOrderNumber(order.orderNumber) : input.orderId}: ${input.expectedStatus} → ${input.toStatus}`,
        metadata: input.reason ? { reason: input.reason } : undefined,
      });
    }
  });
}

/** Customer self-service cancellation within the configured window. */
export async function cancelOwnOrder(actor: Actor, orderId: string) {
  assertRole(actor, ORDERING_ROLES);
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.customerId !== actor.id) throw new NotFoundError("Order not found.");
  if (order.status !== OrderStatus.PENDING) {
    throw new ValidationError("This order can no longer be cancelled because the restaurant has already accepted it.");
  }
  if (order.paymentStatus === "PAID") {
    throw new ValidationError("Paid orders cannot be cancelled online. Please contact the restaurant.");
  }
  const settings = await getSettings();
  if (!isWithinCancelWindow(order.placedAt, settings.customerCancelWindowMinutes)) {
    throw new ValidationError(
      `Orders can only be cancelled within ${settings.customerCancelWindowMinutes} minutes of placing them. Please contact the restaurant.`,
    );
  }
  await prisma.$transaction((tx) =>
    applyStatusChange(tx, {
      orderId,
      from: OrderStatus.PENDING,
      to: OrderStatus.CANCELLED,
      actorId: actor.id,
      reason: "Cancelled by customer",
      extraWhere: { customerId: actor.id, paymentStatus: "UNPAID" },
    }),
  );
}

// ─── Reads ──────────────────────────────────────────────────────────────────

const orderDetailInclude = {
  items: { orderBy: { id: "asc" } },
  payments: { orderBy: { createdAt: "asc" }, include: { recordedBy: { select: { name: true } } } },
  statusEvents: { orderBy: { createdAt: "asc" }, include: { actor: { select: { name: true, role: true } } } },
  table: { select: { label: true } },
  customer: { select: { id: true, name: true, email: true } },
} satisfies Prisma.OrderInclude;

export type OrderDetail = Prisma.OrderGetPayload<{ include: typeof orderDetailInclude }>;

/** Returns the order if the actor may see it. Unauthorised access looks like "not found". */
export async function getOrderForActor(actor: Actor, orderId: string): Promise<OrderDetail> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: orderDetailInclude });
  if (!order || !canAccessOwnedRecord(actor, order.customerId)) throw new NotFoundError("Order not found.");
  return order;
}

export async function listOrdersForCustomer(actor: Actor, page = 1, pageSize = 10) {
  const where = { customerId: actor.id };
  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { placedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { _count: { select: { items: true } } },
    }),
    prisma.order.count({ where }),
  ]);
  return { orders, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export type AdminOrderFilters = {
  status?: OrderStatus;
  type?: OrderType;
  paymentStatus?: "UNPAID" | "PAID" | "REFUNDED";
  q?: string;
  from?: string;
  to?: string;
  page: number;
};

export async function listOrdersForAdmin(actor: Actor, filters: AdminOrderFilters, pageSize = 20) {
  assertRole(actor, [Role.ADMIN]);
  const settings = await getSettings();
  const where: Prisma.OrderWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.type) where.type = filters.type;
  if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
  if (filters.from || filters.to) {
    where.placedAt = {
      ...(filters.from ? { gte: zonedDayRange(filters.from, settings.timezone).start } : {}),
      ...(filters.to ? { lt: zonedDayRange(filters.to, settings.timezone).end } : {}),
    };
  }
  if (filters.q) {
    const numeric = Number(filters.q.replace(/^DD-?/i, ""));
    where.OR = [
      ...(Number.isInteger(numeric) && numeric > 0 && numeric < 2_147_483_647 ? [{ orderNumber: numeric }] : []),
      { contactName: { contains: filters.q, mode: "insensitive" } },
      { customer: { email: { contains: filters.q, mode: "insensitive" } } },
    ];
  }
  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { placedAt: "desc" },
      skip: (filters.page - 1) * pageSize,
      take: pageSize,
      include: { customer: { select: { name: true, email: true } }, _count: { select: { items: true } } },
    }),
    prisma.order.count({ where }),
  ]);
  return { orders, total, page: filters.page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Orders for the kitchen display: everything active plus recently finished orders. */
export async function listKitchenOrders(actor: Actor) {
  assertRole(actor, KITCHEN_ROLES);
  const recentCutoff = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return prisma.order.findMany({
    where: {
      OR: [
        { status: { in: [...ACTIVE_ORDER_STATUSES] } },
        { status: { in: [OrderStatus.COMPLETED, OrderStatus.CANCELLED] }, updatedAt: { gte: recentCutoff } },
      ],
    },
    orderBy: { placedAt: "asc" },
    take: 200,
    select: {
      id: true,
      orderNumber: true,
      type: true,
      status: true,
      paymentStatus: true,
      contactName: true,
      notes: true,
      placedAt: true,
      updatedAt: true,
      table: { select: { label: true } },
      items: {
        select: { id: true, nameSnapshot: true, variantName: true, addOns: true, quantity: true, notes: true },
        orderBy: { id: "asc" },
      },
    },
  });
}

export type KitchenOrder = Awaited<ReturnType<typeof listKitchenOrders>>[number];
