import { describe, expect, it } from "vitest";
import { currencyDigits, formatMoney, isValidCurrency, minorToMajorString, parseMajorToMinor } from "@/lib/money";
import {
  addDaysISO,
  dayOfWeek,
  hhmmToMinutes,
  isValidISODate,
  minutesToHHMM,
  zonedDateISO,
  zonedMinuteOfDay,
  zonedTimeToUtc,
} from "@/lib/time";

describe("time zone helpers", () => {
  it("converts restaurant wall-clock times to UTC", () => {
    expect(zonedTimeToUtc("2026-11-10", 19 * 60, "Asia/Kolkata").toISOString()).toBe("2026-11-10T13:30:00.000Z");
    expect(zonedTimeToUtc("2026-07-01", 9 * 60, "America/New_York").toISOString()).toBe("2026-07-01T13:00:00.000Z"); // EDT
    expect(zonedTimeToUtc("2026-12-01", 9 * 60, "America/New_York").toISOString()).toBe("2026-12-01T14:00:00.000Z"); // EST
  });

  it("round-trips local date and minute of day", () => {
    const instant = zonedTimeToUtc("2026-03-05", 20 * 60 + 30, "Europe/London");
    expect(zonedDateISO(instant, "Europe/London")).toBe("2026-03-05");
    expect(zonedMinuteOfDay(instant, "Europe/London")).toBe(20 * 60 + 30);
  });

  it("handles date arithmetic and parsing", () => {
    expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
    expect(dayOfWeek("2026-10-16")).toBe(5); // Friday
    expect(isValidISODate("2026-02-30")).toBe(false);
    expect(minutesToHHMM(605)).toBe("10:05");
    expect(hhmmToMinutes("23:30")).toBe(1410);
    expect(hhmmToMinutes("24:30")).toBeNull();
    expect(hhmmToMinutes("7:00")).toBeNull();
  });
});

describe("money helpers", () => {
  it("uses ISO 4217 minor units per currency", () => {
    expect(currencyDigits("INR")).toBe(2);
    expect(currencyDigits("JPY")).toBe(0);
    expect(isValidCurrency("USD")).toBe(true);
    expect(isValidCurrency("XYZ1")).toBe(false);
  });

  it("parses decimal input without floating point errors", () => {
    expect(parseMajorToMinor("12.5", "INR")).toBe(1250);
    expect(parseMajorToMinor("0.29", "USD")).toBe(29);
    expect(parseMajorToMinor("1000", "JPY")).toBe(1000);
    expect(parseMajorToMinor("1.5", "JPY")).toBeNull();
    expect(parseMajorToMinor("1.234", "INR")).toBeNull();
    expect(parseMajorToMinor("-5", "INR")).toBeNull();
    expect(parseMajorToMinor("-5", "INR", { allowNegative: true })).toBe(-500);
    expect(parseMajorToMinor("abc", "INR")).toBeNull();
  });

  it("formats and round-trips amounts", () => {
    expect(minorToMajorString(1250, "INR")).toBe("12.50");
    expect(minorToMajorString(-5, "USD")).toBe("-0.05");
    expect(formatMoney(123456, "INR", "en-IN")).toBe("₹1,234.56");
    expect(formatMoney(500, "JPY", "en-US")).toBe("¥500");
  });
});
