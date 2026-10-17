import { prisma, type Db } from "@/lib/db";

export const SETTINGS_ID = 1;

export const DEFAULT_OPENING_HOURS = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  isClosed: false,
  openMinute: 11 * 60,
  closeMinute: 23 * 60,
}));

/**
 * Returns the singleton settings row, creating defaults on first use.
 * The insert is `ON CONFLICT DO NOTHING`, so concurrent first requests on a
 * fresh database cannot fail with a unique-key violation (Prisma's upsert is
 * not atomic).
 */
export async function getSettings(db: Db = prisma) {
  const existing = await db.restaurantSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (existing) return existing;
  await db.restaurantSettings.createMany({ data: [{ id: SETTINGS_ID }], skipDuplicates: true });
  return db.restaurantSettings.findUniqueOrThrow({ where: { id: SETTINGS_ID } });
}

export type RestaurantSettingsRecord = Awaited<ReturnType<typeof getSettings>>;

/** Opening hours for all 7 days (defaults are filled in for missing rows). */
export async function getOpeningHours(db: Db = prisma) {
  const rows = await db.openingHours.findMany({ orderBy: { dayOfWeek: "asc" } });
  return DEFAULT_OPENING_HOURS.map((fallback) => rows.find((row) => row.dayOfWeek === fallback.dayOfWeek) ?? fallback);
}

export async function getHoursForDay(dayOfWeek: number, db: Db = prisma) {
  return db.openingHours.findUnique({ where: { dayOfWeek } });
}

/** Public, non-sensitive subset used by client components for formatting. */
export function toPublicSettings(settings: RestaurantSettingsRecord) {
  return {
    name: settings.name,
    tagline: settings.tagline,
    phone: settings.phone,
    email: settings.email,
    address: settings.address,
    currency: settings.currency,
    locale: settings.locale,
    timezone: settings.timezone,
    taxRateBps: settings.taxRateBps,
    serviceChargeBps: settings.serviceChargeBps,
    deliveryFeeMinor: settings.deliveryFeeMinor,
    enabledOrderTypes: settings.enabledOrderTypes,
    enabledPaymentMethods: settings.enabledPaymentMethods,
    acceptingOrders: settings.acceptingOrders,
    customerCancelWindowMinutes: settings.customerCancelWindowMinutes,
    maxPartySize: settings.maxPartySize,
    reservationMaxDaysAhead: settings.reservationMaxDaysAhead,
    reservationDurationMinutes: settings.reservationDurationMinutes,
  };
}

export type PublicSettings = ReturnType<typeof toPublicSettings>;
