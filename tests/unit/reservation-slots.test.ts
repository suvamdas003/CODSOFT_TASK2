import { describe, expect, it } from "vitest";
import { zonedTimeToUtc } from "@/lib/time";
import { computeSlots, freeTablesFor, isAlignedSlot, overlaps, type ReservationRules } from "@/server/services/reservation-slots";

const rules: ReservationRules = {
  timezone: "Asia/Kolkata",
  reservationDurationMinutes: 90,
  reservationSlotMinutes: 30,
  reservationLeadMinutes: 60,
  reservationMaxDaysAhead: 30,
  maxPartySize: 8,
};
const hours = { isClosed: false, openMinute: 18 * 60, closeMinute: 22 * 60 };
const tables = [
  { id: "t2", label: "T2", capacity: 2 },
  { id: "t4", label: "T4", capacity: 4 },
];
const DATE = "2026-11-10";
const now = new Date("2026-11-09T06:00:00Z");
const at = (minute: number) => zonedTimeToUtc(DATE, minute, rules.timezone);

describe("reservation slots", () => {
  it("treats ranges as half-open intervals", () => {
    const a = new Date("2026-01-01T10:00:00Z");
    const b = new Date("2026-01-01T11:30:00Z");
    expect(overlaps(a, b, b, new Date("2026-01-01T13:00:00Z"))).toBe(false); // back-to-back is fine
    expect(overlaps(a, b, new Date("2026-01-01T11:29:00Z"), new Date("2026-01-01T12:00:00Z"))).toBe(true);
  });

  it("generates slots so a full booking fits before closing", () => {
    const result = computeSlots({ dateISO: DATE, partySize: 2, now, rules, hours, tables, booked: [] });
    expect(result.unavailableReason).toBeUndefined();
    expect(result.slots.map((slot) => slot.label)).toEqual(["18:00", "18:30", "19:00", "19:30", "20:00", "20:30"]);
    expect(result.slots.every((slot) => slot.available)).toBe(true);
  });

  it("marks slots full when every fitting table overlaps an existing booking", () => {
    const booked = [{ tableId: "t4", startsAt: at(19 * 60), endsAt: at(20 * 60 + 30) }];
    const result = computeSlots({ dateISO: DATE, partySize: 3, now, rules, hours, tables, booked });
    const byLabel = Object.fromEntries(result.slots.map((slot) => [slot.label, slot]));
    // Only the 4-top fits a party of 3, and it is booked 19:00–20:30.
    for (const label of ["18:00", "18:30", "19:00", "19:30", "20:00"]) {
      expect(byLabel[label]).toMatchObject({ available: false, reason: "FULL" });
    }
    expect(byLabel["20:30"].available).toBe(true); // starts exactly when the booking ends
    // A party of 2 can still use the 2-top while the 4-top is booked.
    const small = computeSlots({ dateISO: DATE, partySize: 2, now, rules, hours, tables, booked });
    expect(small.slots.every((slot) => slot.available)).toBe(true);
  });

  it("ignores the reservation being modified when checking conflicts", () => {
    const booked = [{ id: "r1", tableId: "t4", startsAt: at(19 * 60), endsAt: at(20 * 60 + 30) }];
    expect(freeTablesFor(tables, booked, 4, at(19 * 60), at(20 * 60 + 30))).toHaveLength(0);
    expect(freeTablesFor(tables, booked, 4, at(19 * 60), at(20 * 60 + 30), "r1").map((t) => t.id)).toEqual(["t4"]);
  });

  it("chooses the smallest table that fits", () => {
    expect(freeTablesFor(tables, [], 2, at(19 * 60), at(20 * 60 + 30)).map((t) => t.id)).toEqual(["t2", "t4"]);
  });

  it("reports closed days, oversize parties and past dates", () => {
    expect(
      computeSlots({ dateISO: DATE, partySize: 2, now, rules, hours: { ...hours, isClosed: true }, tables, booked: [] }).unavailableReason,
    ).toMatch(/closed/);
    expect(computeSlots({ dateISO: DATE, partySize: 9, now, rules, hours, tables, booked: [] }).unavailableReason).toMatch(/1–8/);
    expect(computeSlots({ dateISO: DATE, partySize: 6, now, rules, hours, tables, booked: [] }).unavailableReason).toMatch(/No table/);
    expect(computeSlots({ dateISO: "2026-11-01", partySize: 2, now, rules, hours, tables, booked: [] }).unavailableReason).toMatch(/past/);
    expect(computeSlots({ dateISO: "2027-01-30", partySize: 2, now, rules, hours, tables, booked: [] }).unavailableReason).toMatch(
      /30 days/,
    );
  });

  it("marks slots inside the lead time as unavailable", () => {
    const sameDayNow = new Date(at(18 * 60).getTime() - 30 * 60_000); // 17:30 local
    const result = computeSlots({ dateISO: DATE, partySize: 2, now: sameDayNow, rules, hours, tables, booked: [] });
    expect(result.slots[0]).toMatchObject({ label: "18:00", available: false, reason: "PAST" });
    expect(result.slots[1]).toMatchObject({ label: "18:30", available: true });
  });

  it("validates slot alignment", () => {
    expect(isAlignedSlot(18 * 60 + 30, hours, rules)).toBe(true);
    expect(isAlignedSlot(18 * 60 + 15, hours, rules)).toBe(false);
    expect(isAlignedSlot(21 * 60, hours, rules)).toBe(false); // would end after close
    expect(isAlignedSlot(17 * 60, hours, rules)).toBe(false);
  });
});
