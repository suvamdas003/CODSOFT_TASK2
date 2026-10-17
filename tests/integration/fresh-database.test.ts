import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getPublicMenu } from "@/server/repositories/menu-repository";
import { getOpeningHours, getSettings } from "@/server/repositories/settings-repository";
import { getAvailability } from "@/server/services/reservation-service";
import { futureDate, resetDatabase } from "../support/fixtures";

// A brand-new production database has no settings row and no seed data.
beforeEach(resetDatabase);

describe("fresh, unseeded database (regression: 500 on first page load)", () => {
  it("creates the default settings exactly once under concurrent first requests", async () => {
    // The race is timing-dependent, so repeat it several times on an empty table.
    for (let round = 0; round < 8; round++) {
      await prisma.restaurantSettings.deleteMany();
      const results = await Promise.all(Array.from({ length: 30 }, () => getSettings()));
      expect(new Set(results.map((settings) => settings.id))).toEqual(new Set([1]));
      expect(await prisma.restaurantSettings.count()).toBe(1);
    }
  });

  it("serves an empty menu, default hours and a sensible reservation message", async () => {
    expect((await getPublicMenu()).categories).toEqual([]);
    expect(await getOpeningHours()).toHaveLength(7);
    const availability = await getAvailability({ date: futureDate(2), partySize: 2 });
    expect(availability.slots).toEqual([]);
    expect(availability.unavailableReason).toBeTruthy();
  });
});
