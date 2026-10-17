import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@/lib/errors";
import {
  cancelOwnOrder,
  createOrder,
  getOrderForActor,
  listKitchenOrders,
  quoteCart,
  updateOrderStatus,
} from "@/server/services/order-service";
import { adminActor, customerActor, kitchenActor, newKey, resetDatabase, seedMenu, seedSettings, seedTables } from "../support/fixtures";

let menu: Awaited<ReturnType<typeof seedMenu>>;

beforeEach(async () => {
  await resetDatabase();
  await seedSettings();
  menu = await seedMenu();
});

const base = (items: Parameters<typeof createOrder>[1]["items"]) => ({
  idempotencyKey: newKey(),
  items,
  type: "TAKEAWAY" as const,
  paymentMethod: "CASH" as const,
  contactName: "Test Customer",
});

describe("order creation", () => {
  it("prices orders from the database and snapshots items", async () => {
    const customer = await customerActor();
    const full = menu.curry.variants[1];
    const { orderId, created } = await createOrder(customer, {
      ...base([
        { menuItemId: menu.curry.id, variantId: full.id, addOnIds: [menu.curry.addOns[0].id], quantity: 2 },
        { menuItemId: menu.naan.id, variantId: null, addOnIds: [], quantity: 3 },
      ]),
    });
    expect(created).toBe(true);
    const order = await getOrderForActor(customer, orderId);
    // (400 + 200 + 50) × 2 + 50 × 3 = 1450.00 subtotal; 5% tax; no service charge for takeaway.
    expect(order.subtotalMinor).toBe(145_000);
    expect(order.taxMinor).toBe(7_250);
    expect(order.serviceChargeMinor).toBe(0);
    expect(order.totalMinor).toBe(152_250);
    expect(order.currency).toBe("INR");
    expect(order.items[0]).toMatchObject({
      nameSnapshot: "Butter Chicken",
      variantName: "Full",
      unitPriceMinor: 65_000,
      lineTotalMinor: 130_000,
    });
    expect(order.items[0].addOns).toEqual([{ name: "Extra gravy", priceMinor: 5_000 }]);
    expect(order.payments).toHaveLength(1);
    expect(order.payments[0]).toMatchObject({ provider: "MANUAL", status: "PENDING", amountMinor: 152_250 });
    expect(order.statusEvents.map((event) => event.toStatus)).toEqual(["PENDING"]);

    // Later price changes do not alter the stored receipt.
    await prisma.menuItem.update({ where: { id: menu.curry.id }, data: { priceMinor: 99_999 } });
    const again = await getOrderForActor(customer, orderId);
    expect(again.items[0].unitPriceMinor).toBe(65_000);
    expect(again.totalMinor).toBe(152_250);
  });

  it("applies dine-in service charge, discounts and valid tables", async () => {
    const customer = await customerActor();
    const [table] = await seedTables([4]);
    await prisma.discountCode.create({ data: { code: "TEN", type: "PERCENT", value: 1000 } });
    const { orderId } = await createOrder(customer, {
      ...base([{ menuItemId: menu.naan.id, variantId: null, addOnIds: [], quantity: 10 }]),
      type: "DINE_IN",
      tableId: table.id,
      discountCode: "ten",
    });
    const order = await getOrderForActor(customer, orderId);
    expect(order).toMatchObject({
      subtotalMinor: 50_000,
      discountMinor: 5_000,
      serviceChargeMinor: 4_500,
      taxMinor: 2_475,
      totalMinor: 51_975,
      discountCode: "TEN",
      tableId: table.id,
    });
    expect((await prisma.discountCode.findUniqueOrThrow({ where: { code: "TEN" } })).redemptionCount).toBe(1);
  });

  it("rejects unavailable items, missing variants and foreign add-ons", async () => {
    const customer = await customerActor();
    await expect(
      createOrder(customer, base([{ menuItemId: menu.soldOut.id, variantId: null, addOnIds: [], quantity: 1 }])),
    ).rejects.toThrow(/sold out/);
    await expect(createOrder(customer, base([{ menuItemId: menu.curry.id, variantId: null, addOnIds: [], quantity: 1 }]))).rejects.toThrow(
      /choose an option/i,
    );
    await expect(
      createOrder(
        customer,
        base([{ menuItemId: menu.curry.id, variantId: menu.curry.variants[0].id, addOnIds: [menu.otherItem.addOns[0].id], quantity: 1 }]),
      ),
    ).rejects.toThrow(ValidationError);
    await expect(
      createOrder(customer, base([{ menuItemId: "does-not-exist", variantId: null, addOnIds: [], quantity: 1 }])),
    ).rejects.toThrow(/no longer on the menu/);
    await prisma.itemVariant.update({ where: { id: menu.curry.variants[1].id }, data: { isAvailable: false } });
    await expect(
      createOrder(customer, base([{ menuItemId: menu.curry.id, variantId: menu.curry.variants[1].id, addOnIds: [], quantity: 1 }])),
    ).rejects.toThrow(/unavailable/);
    expect(await prisma.order.count()).toBe(0);
  });

  it("quotes report issues per line instead of failing", async () => {
    const quote = await quoteCart({
      items: [
        { menuItemId: menu.naan.id, variantId: null, addOnIds: [], quantity: 2 },
        { menuItemId: menu.soldOut.id, variantId: null, addOnIds: [], quantity: 1 },
      ],
      type: "TAKEAWAY",
      discountCode: "NOPE",
    });
    expect(quote.issues).toEqual([expect.objectContaining({ index: 1 })]);
    expect(quote.totals.subtotalMinor).toBe(10_000);
    expect(quote.discountMessage).toMatch(/not valid/);
  });

  it("returns the original order for repeated and concurrent submissions with the same key", async () => {
    const customer = await customerActor();
    const input = base([{ menuItemId: menu.naan.id, variantId: null, addOnIds: [], quantity: 1 }]);
    const results = await Promise.all(Array.from({ length: 5 }, () => createOrder(customer, input)));
    expect(new Set(results.map((result) => result.orderId)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    const again = await createOrder(customer, input);
    expect(again).toEqual({ orderId: results[0].orderId, created: false });
    expect(await prisma.order.count()).toBe(1);
  });

  it("never lets a discount exceed its usage limit under concurrency", async () => {
    await prisma.discountCode.create({ data: { code: "ONCE", type: "FIXED", value: 1000, maxRedemptions: 1 } });
    const customers = await Promise.all([customerActor(), customerActor(), customerActor()]);
    const outcomes = await Promise.allSettled(
      customers.map((customer) =>
        createOrder(customer, {
          ...base([{ menuItemId: menu.naan.id, variantId: null, addOnIds: [], quantity: 1 }]),
          discountCode: "ONCE",
        }),
      ),
    );
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect((await prisma.discountCode.findUniqueOrThrow({ where: { code: "ONCE" } })).redemptionCount).toBe(1);
  });

  it("refuses orders when ordering is paused, the type is disabled or online payment is not configured", async () => {
    const customer = await customerActor();
    const items = [{ menuItemId: menu.naan.id, variantId: null, addOnIds: [], quantity: 1 }];
    await expect(createOrder(customer, { ...base(items), paymentMethod: "ONLINE_CARD" })).rejects.toThrow(/not configured/);
    await prisma.restaurantSettings.update({ where: { id: 1 }, data: { enabledOrderTypes: ["TAKEAWAY"] } });
    await expect(
      createOrder(customer, { ...base(items), type: "DELIVERY", deliveryAddress: "1 Long Road, Town", contactPhone: "+911234567" }),
    ).rejects.toThrow(/not available/);
    await prisma.restaurantSettings.update({ where: { id: 1 }, data: { acceptingOrders: false } });
    await expect(createOrder(customer, base(items))).rejects.toThrow(/not accepting/);
  });

  it("does not let kitchen staff place orders", async () => {
    const kitchen = await kitchenActor();
    await expect(createOrder(kitchen, base([{ menuItemId: menu.naan.id, variantId: null, addOnIds: [], quantity: 1 }]))).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("order access and status workflow", () => {
  async function placeOrder() {
    const customer = await customerActor();
    const { orderId } = await createOrder(customer, base([{ menuItemId: menu.naan.id, variantId: null, addOnIds: [], quantity: 1 }]));
    return { customer, orderId };
  }

  it("restricts customers to their own orders", async () => {
    const { orderId } = await placeOrder();
    const stranger = await customerActor();
    await expect(getOrderForActor(stranger, orderId)).rejects.toThrow(NotFoundError);
    await expect(cancelOwnOrder(stranger, orderId)).rejects.toThrow(NotFoundError);
    const kitchen = await kitchenActor();
    await expect(getOrderForActor(kitchen, orderId)).resolves.toMatchObject({ id: orderId });
  });

  it("moves through the kitchen workflow and records each step", async () => {
    const { customer, orderId } = await placeOrder();
    const kitchen = await kitchenActor();
    for (const [from, to] of [
      ["PENDING", "CONFIRMED"],
      ["CONFIRMED", "PREPARING"],
      ["PREPARING", "READY"],
      ["READY", "COMPLETED"],
    ] as const) {
      await updateOrderStatus(kitchen, { orderId, expectedStatus: from, toStatus: to });
    }
    const order = await getOrderForActor(customer, orderId);
    expect(order.status).toBe("COMPLETED");
    expect(order.statusEvents.map((event) => event.toStatus)).toEqual(["PENDING", "CONFIRMED", "PREPARING", "READY", "COMPLETED"]);
    expect(order.confirmedAt && order.preparingAt && order.readyAt && order.completedAt).toBeTruthy();
    expect(order.paymentStatus).toBe("UNPAID"); // preparation never changes payment status
  });

  it("rejects invalid or unauthorised transitions", async () => {
    const { customer, orderId } = await placeOrder();
    const kitchen = await kitchenActor();
    await expect(updateOrderStatus(kitchen, { orderId, expectedStatus: "PENDING", toStatus: "READY" })).rejects.toThrow(ForbiddenError);
    await expect(updateOrderStatus(customer, { orderId, expectedStatus: "PENDING", toStatus: "CONFIRMED" })).rejects.toThrow(
      ForbiddenError,
    );
    await updateOrderStatus(kitchen, { orderId, expectedStatus: "PENDING", toStatus: "CONFIRMED" });
    await updateOrderStatus(kitchen, { orderId, expectedStatus: "CONFIRMED", toStatus: "PREPARING" });
    await expect(updateOrderStatus(kitchen, { orderId, expectedStatus: "PREPARING", toStatus: "CANCELLED" })).rejects.toThrow(
      ForbiddenError,
    );
    const admin = await adminActor();
    await updateOrderStatus(admin, { orderId, expectedStatus: "PREPARING", toStatus: "CANCELLED", reason: "Out of stock" });
    const order = await getOrderForActor(admin, orderId);
    expect(order.status).toBe("CANCELLED");
    expect(order.payments[0].status).toBe("CANCELLED");
    expect(await prisma.auditEvent.count({ where: { action: "order.status", entityId: orderId } })).toBe(1);
  });

  it("applies only one of several simultaneous identical status updates", async () => {
    const { orderId } = await placeOrder();
    const [a, b] = await Promise.all([kitchenActor(), kitchenActor()]);
    const outcomes = await Promise.allSettled([
      updateOrderStatus(a, { orderId, expectedStatus: "PENDING", toStatus: "CONFIRMED" }),
      updateOrderStatus(b, { orderId, expectedStatus: "PENDING", toStatus: "CONFIRMED" }),
      updateOrderStatus(a, { orderId, expectedStatus: "PENDING", toStatus: "CONFIRMED" }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    expect(rejected.every((outcome) => outcome.reason instanceof ConflictError)).toBe(true);
    expect(await prisma.orderStatusEvent.count({ where: { orderId, toStatus: "CONFIRMED" } })).toBe(1);
  });

  it("lets customers cancel only pending orders inside the window", async () => {
    const { customer, orderId } = await placeOrder();
    await cancelOwnOrder(customer, orderId);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("CANCELLED");

    const second = await placeOrder();
    await prisma.order.update({ where: { id: second.orderId }, data: { placedAt: new Date(Date.now() - 10 * 60_000) } });
    await expect(cancelOwnOrder(second.customer, second.orderId)).rejects.toThrow(/within 5 minutes/);

    const third = await placeOrder();
    const kitchen = await kitchenActor();
    await updateOrderStatus(kitchen, { orderId: third.orderId, expectedStatus: "PENDING", toStatus: "CONFIRMED" });
    await expect(cancelOwnOrder(third.customer, third.orderId)).rejects.toThrow(/already accepted/);
  });

  it("lists kitchen orders only for kitchen staff and admins", async () => {
    await placeOrder();
    const kitchen = await kitchenActor();
    expect(await listKitchenOrders(kitchen)).toHaveLength(1);
    await expect(listKitchenOrders(await customerActor())).rejects.toThrow(ForbiddenError);
    await expect(listKitchenOrders(null as never)).rejects.toThrow(UnauthorizedError);
  });
});
