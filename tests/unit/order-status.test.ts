import { describe, expect, it } from "vitest";
import {
  allowedTransitions,
  canTransition,
  isValidTransition,
  isWithinCancelWindow,
  nextForwardStatus,
} from "@/server/services/order-status";

describe("order status machine", () => {
  it("only allows forward steps or cancellation before completion", () => {
    expect(isValidTransition("PENDING", "CONFIRMED")).toBe(true);
    expect(isValidTransition("CONFIRMED", "PREPARING")).toBe(true);
    expect(isValidTransition("PREPARING", "READY")).toBe(true);
    expect(isValidTransition("READY", "COMPLETED")).toBe(true);
    expect(isValidTransition("PENDING", "READY")).toBe(false); // no skipping
    expect(isValidTransition("READY", "PREPARING")).toBe(false); // no going back
    expect(isValidTransition("READY", "CANCELLED")).toBe(false);
    expect(isValidTransition("COMPLETED", "CANCELLED")).toBe(false);
    expect(isValidTransition("CANCELLED", "PENDING")).toBe(false);
  });

  it("restricts transitions by role", () => {
    expect(canTransition("KITCHEN_STAFF", "PENDING", "CONFIRMED")).toBe(true);
    expect(canTransition("KITCHEN_STAFF", "CONFIRMED", "CANCELLED")).toBe(true);
    expect(canTransition("KITCHEN_STAFF", "PREPARING", "CANCELLED")).toBe(false);
    expect(canTransition("ADMIN", "PREPARING", "CANCELLED")).toBe(true);
    expect(canTransition("CUSTOMER", "PENDING", "CANCELLED")).toBe(true);
    expect(canTransition("CUSTOMER", "PENDING", "CONFIRMED")).toBe(false);
    expect(canTransition("CUSTOMER", "CONFIRMED", "CANCELLED")).toBe(false);
  });

  it("exposes the single forward step for the kitchen display", () => {
    expect(nextForwardStatus("PENDING")).toBe("CONFIRMED");
    expect(nextForwardStatus("READY")).toBe("COMPLETED");
    expect(nextForwardStatus("COMPLETED")).toBeNull();
    expect(allowedTransitions("KITCHEN_STAFF", "PREPARING")).toEqual(["READY"]);
  });

  it("checks the customer cancellation window", () => {
    const placed = new Date("2026-01-01T10:00:00Z");
    expect(isWithinCancelWindow(placed, 5, new Date("2026-01-01T10:04:59Z"))).toBe(true);
    expect(isWithinCancelWindow(placed, 5, new Date("2026-01-01T10:05:01Z"))).toBe(false);
    expect(isWithinCancelWindow(placed, 0, placed)).toBe(false);
  });
});
