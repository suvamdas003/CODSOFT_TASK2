import { randomUUID } from "node:crypto";
import { Role } from "@/generated/prisma/enums";
import type { Actor } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { addDaysISO, zonedDateISO } from "@/lib/time";

/** Wipes every application table (test database only). */
export async function resetDatabase() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (!tables.length) return;
  const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

let counter = 0;

export async function createActor(role: Role, name?: string): Promise<Actor> {
  counter += 1;
  const user = await prisma.user.create({
    data: {
      name: name ?? `${role.toLowerCase()} ${counter}`,
      email: `${role.toLowerCase()}-${counter}-${randomUUID().slice(0, 8)}@example.test`,
      role,
    },
  });
  return { id: user.id, role: user.role, name: user.name, email: user.email };
}

export const customerActor = () => createActor(Role.CUSTOMER);
export const kitchenActor = () => createActor(Role.KITCHEN_STAFF);
export const adminActor = () => createActor(Role.ADMIN);

/** Settings: INR, 5% tax, 10% dine-in service charge, ₹40 delivery, open 11:00–23:00 daily. */
export async function seedSettings(overrides: Record<string, unknown> = {}) {
  await prisma.restaurantSettings.create({
    data: {
      id: 1,
      currency: "INR",
      timezone: "Asia/Kolkata",
      taxRateBps: 500,
      serviceChargeBps: 1000,
      deliveryFeeMinor: 4000,
      enabledOrderTypes: ["DINE_IN", "TAKEAWAY", "DELIVERY"],
      enabledPaymentMethods: ["CASH", "ONLINE_CARD"],
      customerCancelWindowMinutes: 5,
      reservationDurationMinutes: 90,
      reservationSlotMinutes: 30,
      reservationLeadMinutes: 60,
      reservationMaxDaysAhead: 30,
      maxPartySize: 10,
      autoConfirmReservations: true,
      ...overrides,
    },
  });
  for (let day = 0; day < 7; day++) {
    await prisma.openingHours.create({ data: { dayOfWeek: day, openMinute: 11 * 60, closeMinute: 23 * 60 } });
  }
}

export async function seedMenu() {
  const category = await prisma.menuCategory.create({ data: { name: "Mains", slug: "mains" } });
  const curry = await prisma.menuItem.create({
    data: {
      categoryId: category.id,
      name: "Butter Chicken",
      slug: "butter-chicken",
      priceMinor: 40000,
      variants: {
        create: [
          { name: "Half", priceDeltaMinor: 0 },
          { name: "Full", priceDeltaMinor: 20000 },
        ],
      },
      addOns: { create: [{ name: "Extra gravy", priceMinor: 5000 }] },
    },
    include: { variants: { orderBy: { priceDeltaMinor: "asc" } }, addOns: true },
  });
  const naan = await prisma.menuItem.create({ data: { categoryId: category.id, name: "Naan", slug: "naan", priceMinor: 5000 } });
  const soldOut = await prisma.menuItem.create({
    data: { categoryId: category.id, name: "Risotto", slug: "risotto", priceMinor: 45000, isAvailable: false },
  });
  const otherItem = await prisma.menuItem.create({
    data: {
      categoryId: category.id,
      name: "Pizza",
      slug: "pizza",
      priceMinor: 30000,
      addOns: { create: [{ name: "Olives", priceMinor: 3000 }] },
    },
    include: { addOns: true },
  });
  return { category, curry, naan, soldOut, otherItem };
}

export async function seedTables(capacities: number[]) {
  const tables = [];
  for (const [index, capacity] of capacities.entries()) {
    tables.push(await prisma.restaurantTable.create({ data: { label: `T${index + 1}`, capacity } }));
  }
  return tables;
}

/** A calendar date a few days ahead in the restaurant time zone. */
export function futureDate(days = 3) {
  return addDaysISO(zonedDateISO(new Date(), "Asia/Kolkata"), days);
}

export const newKey = () => randomUUID();
