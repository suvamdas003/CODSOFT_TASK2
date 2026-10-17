import { DiscountType, OrderType } from "@/generated/prisma/enums";

/**
 * Pure pricing functions. All values are integer minor units; rates are basis
 * points. Rounding is half-up on non-negative integers, so results are
 * deterministic and identical between quotes and order creation.
 */

export type PricingSettings = {
  taxRateBps: number;
  serviceChargeBps: number;
  deliveryFeeMinor: number;
};

export type DiscountRule = {
  type: DiscountType;
  value: number;
  minSubtotalMinor: number;
  maxDiscountMinor: number | null;
};

export type Totals = {
  subtotalMinor: number;
  discountMinor: number;
  serviceChargeMinor: number;
  taxMinor: number;
  deliveryFeeMinor: number;
  totalMinor: number;
};

/** amount × bps / 10 000, rounded half-up. */
export function applyBps(amountMinor: number, bps: number): number {
  if (amountMinor <= 0 || bps <= 0) return 0;
  return Math.floor((amountMinor * bps + 5_000) / 10_000);
}

export function unitPrice(basePriceMinor: number, variantDeltaMinor: number, addOnPricesMinor: number[]): number {
  const unit = basePriceMinor + variantDeltaMinor + addOnPricesMinor.reduce((sum, price) => sum + price, 0);
  return Math.max(0, unit);
}

export function lineTotal(unitPriceMinor: number, quantity: number): number {
  return unitPriceMinor * quantity;
}

export function computeDiscount(subtotalMinor: number, rule: DiscountRule | null): number {
  if (!rule || subtotalMinor <= 0 || subtotalMinor < rule.minSubtotalMinor) return 0;
  let discount = rule.type === DiscountType.PERCENT ? applyBps(subtotalMinor, rule.value) : rule.value;
  if (rule.maxDiscountMinor !== null) discount = Math.min(discount, rule.maxDiscountMinor);
  return Math.max(0, Math.min(discount, subtotalMinor));
}

/**
 * Order of operations:
 *   discounted = subtotal − discount
 *   service    = discounted × serviceChargeBps   (dine-in only)
 *   tax        = (discounted + service) × taxRateBps
 *   delivery   = flat fee                         (delivery only, not taxed)
 *   total      = discounted + service + tax + delivery
 */
export function computeTotals(params: {
  subtotalMinor: number;
  discountMinor: number;
  orderType: OrderType;
  settings: PricingSettings;
}): Totals {
  const { subtotalMinor, orderType, settings } = params;
  const discountMinor = Math.max(0, Math.min(params.discountMinor, subtotalMinor));
  const discounted = subtotalMinor - discountMinor;
  const serviceChargeMinor = orderType === OrderType.DINE_IN ? applyBps(discounted, settings.serviceChargeBps) : 0;
  const taxMinor = applyBps(discounted + serviceChargeMinor, settings.taxRateBps);
  const deliveryFeeMinor = orderType === OrderType.DELIVERY ? Math.max(0, settings.deliveryFeeMinor) : 0;
  return {
    subtotalMinor,
    discountMinor,
    serviceChargeMinor,
    taxMinor,
    deliveryFeeMinor,
    totalMinor: discounted + serviceChargeMinor + taxMinor + deliveryFeeMinor,
  };
}
