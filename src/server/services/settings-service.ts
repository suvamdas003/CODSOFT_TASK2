import type { OrderType, PaymentMethod } from "@/generated/prisma/enums";
import { ADMIN_ROLES, assertRole, type Actor } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { getSettings, SETTINGS_ID } from "@/server/repositories/settings-repository";
import { recordAudit } from "@/server/services/audit-service";

export type SettingsInput = {
  name: string;
  tagline?: string;
  phone?: string;
  email?: string;
  address?: string;
  currency: string;
  locale: string;
  timezone: string;
  taxRate: number;
  serviceCharge: number;
  deliveryFee: number;
  enabledOrderTypes: OrderType[];
  enabledPaymentMethods: PaymentMethod[];
  acceptingOrders: boolean;
  customerCancelWindowMinutes: number;
  reservationDurationMinutes: number;
  reservationSlotMinutes: number;
  reservationLeadMinutes: number;
  reservationMaxDaysAhead: number;
  maxPartySize: number;
  autoConfirmReservations: boolean;
  kitchenLateMinutes: number;
};

export async function updateSettings(actor: Actor, input: SettingsInput) {
  assertRole(actor, ADMIN_ROLES);
  const current = await getSettings();

  if (input.currency !== current.currency) {
    // Menu prices are stored in minor units of the current currency; switching
    // currency with existing prices would silently re-denominate them.
    const pricedItems = await prisma.menuItem.count({ where: { archivedAt: null } });
    if (pricedItems > 0) {
      throw new ValidationError(
        "Currency cannot be changed while menu items exist, because prices are stored in the current currency. Re-price or archive items first.",
        { currency: ["Cannot change while menu items exist."] },
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.restaurantSettings.update({
      where: { id: SETTINGS_ID },
      data: {
        name: input.name,
        tagline: input.tagline ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        currency: input.currency,
        locale: input.locale,
        timezone: input.timezone,
        taxRateBps: input.taxRate,
        serviceChargeBps: input.serviceCharge,
        deliveryFeeMinor: input.deliveryFee,
        enabledOrderTypes: input.enabledOrderTypes,
        enabledPaymentMethods: input.enabledPaymentMethods,
        acceptingOrders: input.acceptingOrders,
        customerCancelWindowMinutes: input.customerCancelWindowMinutes,
        reservationDurationMinutes: input.reservationDurationMinutes,
        reservationSlotMinutes: input.reservationSlotMinutes,
        reservationLeadMinutes: input.reservationLeadMinutes,
        reservationMaxDaysAhead: input.reservationMaxDaysAhead,
        maxPartySize: input.maxPartySize,
        autoConfirmReservations: input.autoConfirmReservations,
        kitchenLateMinutes: input.kitchenLateMinutes,
      },
    });
    const changed = Object.keys(input).filter((key) => {
      const map: Record<string, keyof typeof current> = {
        taxRate: "taxRateBps",
        serviceCharge: "serviceChargeBps",
        deliveryFee: "deliveryFeeMinor",
      };
      const field = map[key] ?? (key as keyof typeof current);
      return JSON.stringify(current[field] ?? null) !== JSON.stringify(updated[field] ?? null);
    });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "settings.update",
      entityType: "RestaurantSettings",
      entityId: String(SETTINGS_ID),
      summary: changed.length ? `Updated settings: ${changed.join(", ")}` : "Saved settings (no changes)",
      metadata: { changed },
    });
    return updated;
  });
}

export async function updateOpeningHours(actor: Actor, days: { dayOfWeek: number; isClosed: boolean; open: number; close: number }[]) {
  assertRole(actor, ADMIN_ROLES);
  await prisma.$transaction(async (tx) => {
    for (const day of days) {
      const data = {
        isClosed: day.isClosed,
        openMinute: day.isClosed ? 0 : day.open,
        closeMinute: day.isClosed ? 0 : day.close,
      };
      await tx.openingHours.upsert({ where: { dayOfWeek: day.dayOfWeek }, update: data, create: { dayOfWeek: day.dayOfWeek, ...data } });
    }
    await recordAudit(tx, {
      actorId: actor.id,
      action: "settings.opening_hours",
      entityType: "OpeningHours",
      summary: "Updated opening hours",
    });
  });
}
