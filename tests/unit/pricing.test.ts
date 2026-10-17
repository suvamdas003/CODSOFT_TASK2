import { describe, expect, it } from "vitest";
import { applyBps, computeDiscount, computeTotals, lineTotal, unitPrice } from "@/server/services/pricing";

const settings = { taxRateBps: 500, serviceChargeBps: 1000, deliveryFeeMinor: 4000 };

describe("pricing", () => {
  it("rounds basis-point amounts half-up in integer minor units", () => {
    expect(applyBps(10_000, 500)).toBe(500);
    expect(applyBps(1_010, 500)).toBe(51); // 50.5 → 51
    expect(applyBps(1_009, 500)).toBe(50); // 50.45 → 50
    expect(applyBps(0, 500)).toBe(0);
    expect(applyBps(10_000, 0)).toBe(0);
  });

  it("computes unit price from base, variant delta and add-ons, never below zero", () => {
    expect(unitPrice(40_000, 20_000, [5_000, 3_000])).toBe(68_000);
    expect(unitPrice(1_000, -5_000, [])).toBe(0);
    expect(lineTotal(68_000, 3)).toBe(204_000);
  });

  it("applies percentage and fixed discounts with caps and minimums", () => {
    const percent = { type: "PERCENT" as const, value: 1000, minSubtotalMinor: 0, maxDiscountMinor: 20_000 };
    expect(computeDiscount(100_000, percent)).toBe(10_000);
    expect(computeDiscount(500_000, percent)).toBe(20_000); // capped
    const fixed = { type: "FIXED" as const, value: 5_000, minSubtotalMinor: 50_000, maxDiscountMinor: null };
    expect(computeDiscount(49_999, fixed)).toBe(0); // below minimum
    expect(computeDiscount(60_000, fixed)).toBe(5_000);
    expect(computeDiscount(3_000, { ...fixed, minSubtotalMinor: 0 })).toBe(3_000); // never exceeds subtotal
    expect(computeDiscount(60_000, null)).toBe(0);
  });

  it("adds service charge only for dine-in and taxes the discounted amount", () => {
    const totals = computeTotals({ subtotalMinor: 100_000, discountMinor: 10_000, orderType: "DINE_IN", settings });
    expect(totals).toEqual({
      subtotalMinor: 100_000,
      discountMinor: 10_000,
      serviceChargeMinor: 9_000, // 10% of 90 000
      taxMinor: 4_950, // 5% of 99 000
      deliveryFeeMinor: 0,
      totalMinor: 103_950,
    });
  });

  it("adds the delivery fee only for delivery orders", () => {
    const delivery = computeTotals({ subtotalMinor: 50_000, discountMinor: 0, orderType: "DELIVERY", settings });
    expect(delivery.serviceChargeMinor).toBe(0);
    expect(delivery.deliveryFeeMinor).toBe(4_000);
    expect(delivery.totalMinor).toBe(50_000 + 2_500 + 4_000);
    const takeaway = computeTotals({ subtotalMinor: 50_000, discountMinor: 0, orderType: "TAKEAWAY", settings });
    expect(takeaway.totalMinor).toBe(52_500);
  });

  it("keeps total = subtotal − discount + service + tax + delivery (DB check constraint)", () => {
    for (const subtotal of [1, 99, 12_345, 999_999]) {
      for (const type of ["DINE_IN", "TAKEAWAY", "DELIVERY"] as const) {
        const t = computeTotals({ subtotalMinor: subtotal, discountMinor: Math.floor(subtotal / 7), orderType: type, settings });
        expect(t.totalMinor).toBe(t.subtotalMinor - t.discountMinor + t.serviceChargeMinor + t.taxMinor + t.deliveryFeeMinor);
        expect(Number.isInteger(t.totalMinor)).toBe(true);
      }
    }
  });
});
