/**
 * DineDesk development seed. Creates SYNTHETIC demo data only:
 * restaurant settings, opening hours, menu, tables, discount codes,
 * development accounts and a few demo orders/reservations.
 *
 * Safe to run repeatedly (existing records are left untouched).
 * Refuses to run when NODE_ENV=production unless ALLOW_DEMO_SEED=true.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { OrderStatus, OrderType, PaymentMethod, Role } from "../src/generated/prisma/enums";
import type { Actor } from "../src/lib/auth/permissions";
import { prisma } from "../src/lib/db";
import { addDaysISO, zonedDateISO } from "../src/lib/time";
import { slugify } from "../src/lib/utils";
import { createOrder, updateOrderStatus } from "../src/server/services/order-service";
import { recordManualPayment } from "../src/server/services/payment-service";
import { createReservation } from "../src/server/services/reservation-service";
import { createCredentialUser } from "../src/server/services/staff-service";
import { SEED_MENU } from "./menu-data";

// Demo data never lands in production by accident: an explicit opt-in is required
// (used by the optional `demo` profile of the Docker stack).
if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
  console.error("Refusing to seed: NODE_ENV is production. The seed creates demo accounts and data.");
  console.error("To load demo data into a throwaway deployment anyway, set ALLOW_DEMO_SEED=true.");
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env and set the SEED_* variables.`);
    process.exit(1);
  }
  return value;
}

async function ensureUser(email: string, password: string, name: string, role: Role): Promise<Actor> {
  const normalized = email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email: normalized } });
  if (existing) {
    console.log(`  • ${role.padEnd(13)} ${normalized} (already exists — password unchanged)`);
    return { id: existing.id, role: existing.role, name: existing.name, email: existing.email };
  }
  const user = await prisma.$transaction((tx) =>
    createCredentialUser(tx, { name, email: normalized, password, role, emailVerified: true }),
  );
  console.log(`  • ${role.padEnd(13)} ${normalized} (created)`);
  return { id: user.id, role: user.role, name: user.name, email: user.email };
}

async function main() {
  console.log("Seeding DineDesk demo data…");

  await prisma.restaurantSettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      name: "DineDesk Bistro (Demo)",
      tagline: "Modern Indian kitchen & bar — demonstration data",
      phone: "+91 00000 00000",
      email: "hello@dinedesk.test",
      address: "1 Demo Street, Example City",
      currency: "INR",
      locale: "en-IN",
      timezone: "Asia/Kolkata",
      taxRateBps: 500,
      serviceChargeBps: 500,
      deliveryFeeMinor: 4000,
      enabledOrderTypes: [OrderType.DINE_IN, OrderType.TAKEAWAY, OrderType.DELIVERY],
      enabledPaymentMethods: [PaymentMethod.CASH, PaymentMethod.ONLINE_CARD],
      customerCancelWindowMinutes: 5,
      reservationDurationMinutes: 90,
      reservationSlotMinutes: 30,
      reservationLeadMinutes: 60,
      reservationMaxDaysAhead: 30,
      maxPartySize: 10,
      autoConfirmReservations: true,
      kitchenLateMinutes: 20,
    },
  });

  for (let day = 0; day < 7; day++) {
    await prisma.openingHours.upsert({
      where: { dayOfWeek: day },
      update: {},
      create: { dayOfWeek: day, isClosed: false, openMinute: 11 * 60, closeMinute: 23 * 60 },
    });
  }
  console.log("✓ Settings and opening hours");

  let sortOrder = 0;
  for (const category of SEED_MENU) {
    const slug = slugify(category.name);
    const record = await prisma.menuCategory.upsert({
      where: { slug },
      update: {},
      create: { name: category.name, slug, description: category.description, sortOrder: sortOrder++ * 10 },
    });
    let itemOrder = 0;
    for (const item of category.items) {
      const itemSlug = slugify(item.name);
      const exists = await prisma.menuItem.findUnique({ where: { slug: itemSlug } });
      if (exists) continue;
      await prisma.menuItem.create({
        data: {
          categoryId: record.id,
          name: item.name,
          slug: itemSlug,
          description: item.description,
          priceMinor: item.price,
          imageUrl: `/images/menu/${itemSlug}.svg`,
          dietaryLabels: item.dietary ?? [],
          isFeatured: item.featured ?? false,
          isAvailable: item.available ?? true,
          prepTimeMinutes: item.prep ?? null,
          sortOrder: itemOrder++ * 10,
          variants: {
            create: (item.variants ?? []).map((variant, index) => ({
              name: variant.name,
              priceDeltaMinor: variant.delta,
              sortOrder: index,
            })),
          },
          addOns: { create: (item.addOns ?? []).map((addOn, index) => ({ name: addOn.name, priceMinor: addOn.price, sortOrder: index })) },
        },
      });
    }
  }
  console.log(`✓ Menu (${SEED_MENU.length} categories)`);

  const tables = [
    { label: "T1", capacity: 2, location: "Window" },
    { label: "T2", capacity: 2, location: "Window" },
    { label: "T3", capacity: 4, location: "Main hall" },
    { label: "T4", capacity: 4, location: "Main hall" },
    { label: "T5", capacity: 4, location: "Patio" },
    { label: "T6", capacity: 6, location: "Main hall" },
    { label: "T7", capacity: 8, location: "Private room" },
  ];
  for (const table of tables) {
    await prisma.restaurantTable.upsert({ where: { label: table.label }, update: {}, create: table });
  }
  console.log(`✓ Tables (${tables.length})`);

  await prisma.discountCode.upsert({
    where: { code: "WELCOME10" },
    update: {},
    create: { code: "WELCOME10", description: "10% off, up to ₹200 (demo)", type: "PERCENT", value: 1000, maxDiscountMinor: 20000 },
  });
  await prisma.discountCode.upsert({
    where: { code: "FLAT50" },
    update: {},
    create: { code: "FLAT50", description: "₹50 off orders over ₹500 (demo)", type: "FIXED", value: 5000, minSubtotalMinor: 50000 },
  });
  console.log("✓ Discount codes (WELCOME10, FLAT50)");

  console.log("✓ Development accounts:");
  const admin = await ensureUser(requireEnv("SEED_ADMIN_EMAIL"), requireEnv("SEED_ADMIN_PASSWORD"), "Demo Admin", Role.ADMIN);
  const kitchen = await ensureUser(
    requireEnv("SEED_KITCHEN_EMAIL"),
    requireEnv("SEED_KITCHEN_PASSWORD"),
    "Demo Kitchen",
    Role.KITCHEN_STAFF,
  );
  const customer = await ensureUser(
    requireEnv("SEED_CUSTOMER_EMAIL"),
    requireEnv("SEED_CUSTOMER_PASSWORD"),
    "Demo Customer",
    Role.CUSTOMER,
  );

  if ((await prisma.order.count()) === 0) {
    const item = async (name: string) =>
      prisma.menuItem.findUniqueOrThrow({ where: { slug: slugify(name) }, include: { variants: true, addOns: true } });
    const butterChicken = await item("Butter Chicken");
    const naan = await item("Garlic Naan");
    const pizza = await item("Margherita Pizza");
    const chai = await item("Masala Chai");
    const lavaCake = await item("Chocolate Lava Cake");
    const t3 = await prisma.restaurantTable.findUniqueOrThrow({ where: { label: "T3" } });

    const base = { contactName: "Demo Customer", contactPhone: "+91 90000 00000", notes: "Demo order (seed data)" };
    const first = await createOrder(customer, {
      ...base,
      idempotencyKey: randomUUID(),
      type: OrderType.DINE_IN,
      paymentMethod: PaymentMethod.CASH,
      tableId: t3.id,
      items: [
        { menuItemId: butterChicken.id, variantId: butterChicken.variants[1]!.id, addOnIds: [butterChicken.addOns[1]!.id], quantity: 1 },
        { menuItemId: naan.id, variantId: null, addOnIds: [], quantity: 2 },
      ],
    });
    const second = await createOrder(customer, {
      ...base,
      idempotencyKey: randomUUID(),
      type: OrderType.TAKEAWAY,
      paymentMethod: PaymentMethod.CASH,
      discountCode: "WELCOME10",
      items: [{ menuItemId: pizza.id, variantId: pizza.variants[0]!.id, addOnIds: [pizza.addOns[0]!.id], quantity: 2 }],
    });
    await createOrder(customer, {
      ...base,
      idempotencyKey: randomUUID(),
      type: OrderType.TAKEAWAY,
      paymentMethod: PaymentMethod.CASH,
      items: [
        { menuItemId: chai.id, variantId: null, addOnIds: [], quantity: 2 },
        { menuItemId: lavaCake.id, variantId: null, addOnIds: [], quantity: 1, notes: "Extra warm please" },
      ],
    });

    for (const [from, to] of [
      [OrderStatus.PENDING, OrderStatus.CONFIRMED],
      [OrderStatus.CONFIRMED, OrderStatus.PREPARING],
      [OrderStatus.PREPARING, OrderStatus.READY],
      [OrderStatus.READY, OrderStatus.COMPLETED],
    ] as const) {
      await updateOrderStatus(kitchen, { orderId: first.orderId, expectedStatus: from, toStatus: to });
    }
    await recordManualPayment(admin, { orderId: first.orderId, reference: "DEMO-CASH-0001" });
    await updateOrderStatus(kitchen, { orderId: second.orderId, expectedStatus: OrderStatus.PENDING, toStatus: OrderStatus.CONFIRMED });
    await updateOrderStatus(kitchen, { orderId: second.orderId, expectedStatus: OrderStatus.CONFIRMED, toStatus: OrderStatus.PREPARING });
    console.log("✓ Demo orders (3)");
  } else {
    console.log("• Orders already exist — skipping demo orders");
  }

  if ((await prisma.reservation.count()) === 0) {
    const settings = await prisma.restaurantSettings.findUniqueOrThrow({ where: { id: 1 } });
    const tomorrow = addDaysISO(zonedDateISO(new Date(), settings.timezone), 1);
    await createReservation(customer, {
      date: tomorrow,
      startMinute: 19 * 60,
      partySize: 2,
      contactName: "Demo Customer",
      contactPhone: "+91 90000 00000",
      notes: "Demo reservation (seed data) — window seat if possible",
    });
    await createReservation(admin, {
      date: tomorrow,
      startMinute: 20 * 60,
      partySize: 6,
      contactName: "Phone booking (demo)",
      contactPhone: "+91 90000 00001",
    });
    console.log("✓ Demo reservations (2)");
  } else {
    console.log("• Reservations already exist — skipping demo reservations");
  }

  console.log("Done. Sign-in emails are listed above; passwords come from your .env SEED_* variables.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
