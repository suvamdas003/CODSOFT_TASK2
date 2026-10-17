import { describe, expect, it } from "vitest";
import { assertRole, canAccessOwnedRecord, hasRole, homePathForRole, type Actor } from "@/lib/auth/permissions";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";
import { __test__ as loggerInternals } from "@/lib/logger";
import { consumeRateLimit } from "@/lib/rate-limit";
import { menuItemSchema, parsePercentToBps } from "@/lib/validation/admin";
import { safeNextPath } from "@/lib/validation/auth";
import { checkoutSchema } from "@/lib/validation/order";

const customer: Actor = { id: "u1", role: "CUSTOMER", name: "C", email: "c@example.test" };
const kitchen: Actor = { id: "u2", role: "KITCHEN_STAFF", name: "K", email: "k@example.test" };
const admin: Actor = { id: "u3", role: "ADMIN", name: "A", email: "a@example.test" };

describe("role permissions", () => {
  it("asserts roles and distinguishes unauthenticated from forbidden", () => {
    expect(() => assertRole(null, ["ADMIN"])).toThrow(UnauthorizedError);
    expect(() => assertRole(customer, ["ADMIN"])).toThrow(ForbiddenError);
    expect(() => assertRole(kitchen, ["KITCHEN_STAFF", "ADMIN"])).not.toThrow();
    expect(hasRole(admin, ["ADMIN"])).toBe(true);
  });

  it("enforces record ownership for customers but not staff", () => {
    expect(canAccessOwnedRecord(customer, "u1")).toBe(true);
    expect(canAccessOwnedRecord(customer, "someone-else")).toBe(false);
    expect(canAccessOwnedRecord(customer, null)).toBe(false);
    expect(canAccessOwnedRecord(kitchen, "someone-else")).toBe(true);
    expect(canAccessOwnedRecord(admin, null)).toBe(true);
  });

  it("routes users to the right home after login", () => {
    expect(homePathForRole("ADMIN")).toBe("/admin");
    expect(homePathForRole("KITCHEN_STAFF")).toBe("/kitchen");
    expect(homePathForRole("CUSTOMER")).toBe("/menu");
  });
});

describe("input validation", () => {
  const base = {
    idempotencyKey: "0b8f4c56-6a63-4a8e-9a43-08f6c3f3d6a1",
    items: [{ menuItemId: "item1", quantity: 2 }],
    type: "TAKEAWAY",
    paymentMethod: "CASH",
    contactName: "Asha",
  };

  it("strips client-supplied prices and totals from checkout input", () => {
    const parsed = checkoutSchema.parse({
      ...base,
      totalMinor: 1,
      items: [{ menuItemId: "item1", quantity: 2, unitPriceMinor: 1, lineTotalMinor: 2 }],
    });
    expect(parsed).not.toHaveProperty("totalMinor");
    expect(parsed.items[0]).not.toHaveProperty("unitPriceMinor");
    expect(parsed.items[0]).toEqual({ menuItemId: "item1", variantId: null, addOnIds: [], quantity: 2, notes: undefined });
  });

  it("rejects invalid quantities, duplicate add-ons and incomplete delivery details", () => {
    expect(checkoutSchema.safeParse({ ...base, items: [{ menuItemId: "x", quantity: 0 }] }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, items: [{ menuItemId: "x", quantity: 51 }] }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, items: [{ menuItemId: "x", quantity: 1, addOnIds: ["a", "a"] }] }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    const delivery = checkoutSchema.safeParse({ ...base, type: "DELIVERY" });
    expect(delivery.success).toBe(false);
    expect(
      checkoutSchema.safeParse({ ...base, type: "DELIVERY", deliveryAddress: "12 Long Street, City", contactPhone: "+91 98765 43210" })
        .success,
    ).toBe(true);
    expect(checkoutSchema.safeParse({ ...base, idempotencyKey: "not-a-uuid" }).success).toBe(false);
  });

  it("only allows same-site relative redirects after login", () => {
    expect(safeNextPath("/orders/123")).toBe("/orders/123");
    expect(safeNextPath("https://evil.example")).toBeNull();
    expect(safeNextPath("//evil.example")).toBeNull();
    expect(safeNextPath("/\\evil.example")).toBeNull();
    expect(safeNextPath("/api/auth/sign-out")).toBeNull();
  });

  it("parses admin money, percentages and image URLs safely", () => {
    const schema = menuItemSchema("INR");
    const ok = schema.parse({ categoryId: "c1", name: "Dosa", price: "120.50", imageUrl: "/images/menu/dosa.svg", isPublished: "on" });
    expect(ok.price).toBe(12050);
    expect(ok.isPublished).toBe(true);
    expect(ok.isAvailable).toBe(false);
    expect(schema.safeParse({ categoryId: "c1", name: "Dosa", price: "12.345" }).success).toBe(false);
    expect(schema.safeParse({ categoryId: "c1", name: "Dosa", price: "10", imageUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(schema.safeParse({ categoryId: "c1", name: "Dosa", price: "10", imageUrl: "http://insecure.example/x.png" }).success).toBe(
      false,
    );
    expect(parsePercentToBps("5")).toBe(500);
    expect(parsePercentToBps("12.25")).toBe(1225);
    expect(parsePercentToBps("101")).toBeNull();
  });
});

describe("rate limiting and logging", () => {
  it("blocks requests over the limit until the window resets", () => {
    const rule = { limit: 2, windowMs: 1000 };
    expect(consumeRateLimit("k", rule, 0).allowed).toBe(true);
    expect(consumeRateLimit("k", rule, 10).allowed).toBe(true);
    expect(consumeRateLimit("k", rule, 20).allowed).toBe(false);
    expect(consumeRateLimit("k", rule, 1001).allowed).toBe(true);
  });

  it("redacts secrets in log context", () => {
    const redacted = loggerInternals.redact({ password: "p", nested: { apiKey: "k", token: "t", ok: 1 }, Authorization: "Bearer x" });
    expect(redacted).toEqual({
      password: "[REDACTED]",
      nested: { apiKey: "[REDACTED]", token: "[REDACTED]", ok: 1 },
      Authorization: "[REDACTED]",
    });
  });
});
