import { z } from "zod";
import { OrderStatus, OrderType, PaymentMethod } from "@/generated/prisma/enums";
import { idSchema, nameSchema, optionalPhoneSchema, optionalText } from "@/lib/validation/common";

export const MAX_LINE_QUANTITY = 50;
export const MAX_CART_LINES = 50;

export const cartLineSchema = z.object({
  menuItemId: idSchema,
  variantId: idSchema.nullish().transform((value) => value ?? null),
  addOnIds: z
    .array(idSchema)
    .max(20)
    .default([])
    .refine((ids) => new Set(ids).size === ids.length, "Each add-on can be selected once."),
  quantity: z
    .number()
    .int("Quantity must be a whole number.")
    .min(1, "Quantity must be at least 1.")
    .max(MAX_LINE_QUANTITY, `Quantity must be at most ${MAX_LINE_QUANTITY}.`),
  notes: optionalText(200),
});

export const cartSchema = z.array(cartLineSchema).min(1, "Your cart is empty.").max(MAX_CART_LINES, "Your cart has too many lines.");

export type CartLineInput = z.input<typeof cartLineSchema>;
export type CartLine = z.output<typeof cartLineSchema>;

export const checkoutSchema = z
  .object({
    idempotencyKey: z.uuid("Invalid checkout session. Please refresh the page."),
    items: cartSchema,
    type: z.enum(OrderType, "Choose how you want to receive your order."),
    paymentMethod: z.enum(PaymentMethod, "Choose a payment method."),
    contactName: nameSchema,
    contactPhone: optionalPhoneSchema,
    deliveryAddress: optionalText(300),
    tableId: idSchema.optional().or(z.literal("").transform(() => undefined)),
    notes: optionalText(500),
    discountCode: z
      .string()
      .trim()
      .toUpperCase()
      .max(32)
      .optional()
      .transform((value) => (value ? value : undefined)),
  })
  .superRefine((value, ctx) => {
    if (value.type === OrderType.DELIVERY) {
      if (!value.deliveryAddress || value.deliveryAddress.length < 8) {
        ctx.addIssue({ code: "custom", path: ["deliveryAddress"], message: "Enter a full delivery address." });
      }
      if (!value.contactPhone) {
        ctx.addIssue({ code: "custom", path: ["contactPhone"], message: "A phone number is required for delivery." });
      }
    }
    if (value.type !== OrderType.DINE_IN && value.tableId) {
      ctx.addIssue({ code: "custom", path: ["tableId"], message: "A table can only be chosen for dine-in orders." });
    }
  });

export type CheckoutInput = z.input<typeof checkoutSchema>;

export const quoteSchema = z.object({
  items: z.array(cartLineSchema).max(MAX_CART_LINES),
  type: z.enum(OrderType).default(OrderType.TAKEAWAY),
  discountCode: z
    .string()
    .trim()
    .toUpperCase()
    .max(32)
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export const orderStatusUpdateSchema = z.object({
  orderId: idSchema,
  expectedStatus: z.enum(OrderStatus),
  toStatus: z.enum(OrderStatus),
  reason: optionalText(200),
});

export const orderListFilterSchema = z.object({
  status: z.enum(OrderStatus).optional().catch(undefined),
  type: z.enum(OrderType).optional().catch(undefined),
  paymentStatus: z.enum(["UNPAID", "PAID", "REFUNDED"]).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});
