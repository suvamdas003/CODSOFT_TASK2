import { DiscountType } from "@/generated/prisma/enums";
import { ADMIN_ROLES, assertRole, type Actor } from "@/lib/auth/permissions";
import { isUniqueViolation, prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { parseMajorToMinor } from "@/lib/money";
import { parsePercentToBps } from "@/lib/validation/admin";
import { recordAudit } from "@/server/services/audit-service";

export type DiscountFormInput = {
  code: string;
  description?: string;
  type: DiscountType;
  value: string;
  minSubtotal?: string;
  maxDiscount?: string;
  maxRedemptions: number | null;
  startsAt?: string;
  endsAt?: string;
  isActive: boolean;
};

function parseOptionalDate(value: string | undefined, field: string): Date | null {
  if (!value || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ValidationError("Enter a valid date.", { [field]: ["Invalid date."] });
  return date;
}

/** Converts form strings to stored values using the restaurant currency. */
export function normalizeDiscount(input: DiscountFormInput, currency: string) {
  const value = input.type === DiscountType.PERCENT ? parsePercentToBps(input.value) : parseMajorToMinor(input.value, currency);
  if (value === null || value <= 0) {
    throw new ValidationError("Enter a valid discount value.", {
      value: [input.type === DiscountType.PERCENT ? "Enter a percentage between 0 and 100." : "Enter a valid amount."],
    });
  }
  const minSubtotalMinor = input.minSubtotal?.trim() ? parseMajorToMinor(input.minSubtotal, currency) : 0;
  if (minSubtotalMinor === null) throw new ValidationError("Enter a valid minimum order amount.", { minSubtotal: ["Invalid amount."] });
  const maxDiscountMinor = input.maxDiscount?.trim() ? parseMajorToMinor(input.maxDiscount, currency) : null;
  if (input.maxDiscount?.trim() && maxDiscountMinor === null) {
    throw new ValidationError("Enter a valid maximum discount.", { maxDiscount: ["Invalid amount."] });
  }
  const startsAt = parseOptionalDate(input.startsAt, "startsAt");
  const endsAt = parseOptionalDate(input.endsAt, "endsAt");
  if (startsAt && endsAt && endsAt <= startsAt)
    throw new ValidationError("End date must be after start date.", { endsAt: ["Must be after start."] });
  return {
    code: input.code,
    description: input.description ?? null,
    type: input.type,
    value,
    minSubtotalMinor,
    maxDiscountMinor,
    maxRedemptions: input.maxRedemptions,
    startsAt,
    endsAt,
    isActive: input.isActive,
  };
}

export async function listDiscounts() {
  return prisma.discountCode.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "desc" }] });
}

export async function createDiscount(actor: Actor, input: DiscountFormInput, currency: string) {
  assertRole(actor, ADMIN_ROLES);
  const data = normalizeDiscount(input, currency);
  try {
    return await prisma.$transaction(async (tx) => {
      const discount = await tx.discountCode.create({ data });
      await recordAudit(tx, {
        actorId: actor.id,
        action: "discount.create",
        entityType: "DiscountCode",
        entityId: discount.id,
        summary: `Created discount code ${discount.code}`,
      });
      return discount;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ValidationError("This code already exists.", { code: ["Code already exists."] });
    throw error;
  }
}

export async function setDiscountActive(actor: Actor, id: string, isActive: boolean) {
  assertRole(actor, ADMIN_ROLES);
  await prisma.$transaction(async (tx) => {
    const discount = await tx.discountCode.findUnique({ where: { id } });
    if (!discount) throw new NotFoundError("Discount code not found.");
    await tx.discountCode.update({ where: { id }, data: { isActive } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: isActive ? "discount.activate" : "discount.deactivate",
      entityType: "DiscountCode",
      entityId: id,
      summary: `${isActive ? "Activated" : "Deactivated"} discount code ${discount.code}`,
    });
  });
}
