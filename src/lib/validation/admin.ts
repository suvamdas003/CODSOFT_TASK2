import { z } from "zod";
import { DietaryLabel, DiscountType, OrderType, PaymentMethod, Role } from "@/generated/prisma/enums";
import { isValidCurrency, parseMajorToMinor } from "@/lib/money";
import { hhmmToMinutes, isValidTimeZone } from "@/lib/time";
import { checkboxSchema, emailSchema, idSchema, intFromInput, nameSchema, optionalText, passwordSchema } from "@/lib/validation/common";

/** Decimal string → minor units for the given currency. */
export const moneyInput = (currency: string, { allowNegative = false, label = "Amount" } = {}) =>
  z.string().transform((value, ctx) => {
    const minor = parseMajorToMinor(value, currency, { allowNegative });
    if (minor === null) {
      ctx.addIssue({ code: "custom", message: `${label} must be a valid amount (e.g. 120 or 120.50).` });
      return z.NEVER;
    }
    return minor;
  });

export const optionalMoneyInput = (currency: string, label = "Amount") =>
  z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value || !value.trim()) return null;
      const minor = parseMajorToMinor(value, currency);
      if (minor === null) {
        ctx.addIssue({ code: "custom", message: `${label} must be a valid amount.` });
        return z.NEVER;
      }
      return minor;
    });

/** "5" or "5.25" percent → basis points (500 / 525). */
export function parsePercentToBps(value: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  return bps <= 10_000 ? bps : null;
}

export const percentInput = (label = "Percentage") =>
  z.string().transform((value, ctx) => {
    const bps = parsePercentToBps(value);
    if (bps === null) {
      ctx.addIssue({ code: "custom", message: `${label} must be between 0 and 100 with up to 2 decimals.` });
      return z.NEVER;
    }
    return bps;
  });

const sortOrder = intFromInput(0, 10_000, "Sort order").default(0);

export const categorySchema = z.object({
  name: nameSchema,
  description: optionalText(300),
  sortOrder,
  isActive: checkboxSchema,
});

const imageUrlSchema = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((value) => (value ? value : null))
  .refine(
    (value) => value === null || /^\/images\/[A-Za-z0-9/_.-]+$/.test(value) || /^https:\/\/[^\s"'<>]+$/.test(value),
    "Use a local path under /images/ or an https:// URL.",
  );

export const menuItemSchema = (currency: string) =>
  z.object({
    categoryId: idSchema,
    name: nameSchema,
    description: z.string().trim().max(600, "Must be 600 characters or fewer.").default(""),
    price: moneyInput(currency, { label: "Price" }),
    imageUrl: imageUrlSchema,
    dietaryLabels: z
      .union([z.enum(DietaryLabel), z.array(z.enum(DietaryLabel))])
      .optional()
      .transform((value) => (value === undefined ? [] : Array.isArray(value) ? [...new Set(value)] : [value])),
    isPublished: checkboxSchema,
    isAvailable: checkboxSchema,
    isFeatured: checkboxSchema,
    prepTimeMinutes: z
      .string()
      .optional()
      .transform((value) => (value && value.trim() ? Number(value) : null))
      .refine((value) => value === null || (Number.isInteger(value) && value >= 0 && value <= 240), "Prep time must be 0–240 minutes."),
    sortOrder,
  });

export const variantSchema = (currency: string) =>
  z.object({
    menuItemId: idSchema,
    name: z.string().trim().min(1, "Enter a name.").max(60),
    priceDelta: moneyInput(currency, { allowNegative: true, label: "Price difference" }),
    isAvailable: checkboxSchema,
    sortOrder,
  });

export const addOnSchema = (currency: string) =>
  z.object({
    menuItemId: idSchema,
    name: z.string().trim().min(1, "Enter a name.").max(60),
    price: moneyInput(currency, { label: "Price" }),
    isAvailable: checkboxSchema,
    sortOrder,
  });

export const tableSchema = z.object({
  label: z.string().trim().min(1, "Enter a label.").max(20, "Use 20 characters or fewer."),
  capacity: intFromInput(1, 50, "Capacity"),
  location: optionalText(60),
  isActive: checkboxSchema,
});

export const staffCreateSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(Role),
});

export const roleChangeSchema = z.object({ userId: idSchema, role: z.enum(Role) });
export const activeChangeSchema = z.object({ userId: idSchema, isActive: z.boolean() });

const timeInput = z.string().transform((value, ctx) => {
  const minutes = hhmmToMinutes(value);
  if (minutes === null) {
    ctx.addIssue({ code: "custom", message: "Use HH:MM (24-hour) time." });
    return z.NEVER;
  }
  return minutes;
});

export const openingHoursSchema = z
  .array(
    z
      .object({
        dayOfWeek: z.number().int().min(0).max(6),
        isClosed: z.boolean(),
        open: timeInput,
        close: timeInput,
      })
      .refine((day) => day.isClosed || day.close > day.open, {
        message: "Closing time must be after opening time.",
        path: ["close"],
      }),
  )
  .length(7);

export const settingsSchema = (currentCurrency: string) =>
  z.object({
    name: z.string().trim().min(2).max(80),
    tagline: optionalText(120),
    phone: optionalText(30),
    email: z
      .union([emailSchema, z.literal("")])
      .optional()
      .transform((value) => (value ? value : undefined)),
    address: optionalText(200),
    currency: z.string().trim().toUpperCase().refine(isValidCurrency, "Enter a valid ISO 4217 currency code (e.g. INR, USD)."),
    locale: z
      .string()
      .trim()
      .min(2)
      .max(20)
      .refine((value) => {
        try {
          new Intl.NumberFormat(value);
          return true;
        } catch {
          return false;
        }
      }, "Enter a valid locale (e.g. en-IN)."),
    timezone: z.string().trim().refine(isValidTimeZone, "Enter a valid IANA time zone (e.g. Asia/Kolkata)."),
    taxRate: percentInput("Tax rate"),
    serviceCharge: percentInput("Service charge"),
    deliveryFee: moneyInput(currentCurrency, { label: "Delivery fee" }),
    enabledOrderTypes: z
      .union([z.enum(OrderType), z.array(z.enum(OrderType))])
      .optional()
      .transform((value) => (value === undefined ? [] : Array.isArray(value) ? [...new Set(value)] : [value]))
      .refine((value) => value.length > 0, "Enable at least one order type."),
    enabledPaymentMethods: z
      .union([z.enum(PaymentMethod), z.array(z.enum(PaymentMethod))])
      .optional()
      .transform((value) => (value === undefined ? [] : Array.isArray(value) ? [...new Set(value)] : [value]))
      .refine((value) => value.length > 0, "Enable at least one payment method."),
    acceptingOrders: checkboxSchema,
    customerCancelWindowMinutes: intFromInput(0, 120, "Cancellation window"),
    reservationDurationMinutes: intFromInput(15, 360, "Reservation duration"),
    reservationSlotMinutes: intFromInput(5, 120, "Slot interval"),
    reservationLeadMinutes: intFromInput(0, 10_080, "Booking lead time"),
    reservationMaxDaysAhead: intFromInput(1, 365, "Booking window"),
    maxPartySize: intFromInput(1, 100, "Max party size"),
    autoConfirmReservations: checkboxSchema,
    kitchenLateMinutes: intFromInput(1, 240, "Late threshold"),
  });

export const discountSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{3,32}$/, "Use 3–32 letters, numbers, dashes or underscores."),
  description: optionalText(120),
  type: z.enum(DiscountType),
  value: z.string().trim().min(1, "Enter a value."),
  minSubtotal: z.string().optional(),
  maxDiscount: z.string().optional(),
  maxRedemptions: z
    .string()
    .optional()
    .transform((value) => (value && value.trim() ? Number(value) : null))
    .refine((value) => value === null || (Number.isInteger(value) && value > 0 && value <= 1_000_000), "Must be a positive whole number."),
  startsAt: z.string().optional(),
  endsAt: z.string().optional(),
  isActive: checkboxSchema,
});

export const idOnlySchema = z.object({ id: idSchema });
