import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { zonedTimeToUtc } from "@/lib/time";
import {
  cancelReservation,
  createReservation,
  getAvailability,
  modifyReservation,
  updateReservationStatus,
} from "@/server/services/reservation-service";
import { adminActor, customerActor, futureDate, resetDatabase, seedSettings, seedTables } from "../support/fixtures";

const DATE = futureDate(3);
const booking = (overrides: Partial<Parameters<typeof createReservation>[1]> = {}) => ({
  date: DATE,
  startMinute: 19 * 60,
  partySize: 4,
  contactName: "Guest",
  contactPhone: "+91 98765 43210",
  ...overrides,
});

beforeEach(async () => {
  await resetDatabase();
  await seedSettings();
});

describe("reservations", () => {
  it("books the smallest free table and stores the restaurant-local time", async () => {
    await seedTables([2, 4, 6]);
    const customer = await customerActor();
    const reservation = await createReservation(customer, booking());
    const table = await prisma.restaurantTable.findUniqueOrThrow({ where: { id: reservation.tableId } });
    expect(table.capacity).toBe(4);
    expect(reservation.status).toBe("CONFIRMED");
    expect(reservation.startsAt.toISOString()).toBe(zonedTimeToUtc(DATE, 19 * 60, "Asia/Kolkata").toISOString());
    expect(reservation.endsAt.getTime() - reservation.startsAt.getTime()).toBe(90 * 60_000);
    expect(reservation.code).toMatch(/^[2-9A-Z]{8}$/);
  });

  it("uses another table when one is taken and refuses when all are taken", async () => {
    await seedTables([4, 4]);
    const first = await createReservation(await customerActor(), booking());
    const second = await createReservation(await customerActor(), booking({ startMinute: 19 * 60 + 30 }));
    expect(second.tableId).not.toBe(first.tableId);
    await expect(createReservation(await customerActor(), booking({ startMinute: 20 * 60 }))).rejects.toThrow(ConflictError);
    // Back-to-back after the first booking ends is fine.
    await expect(createReservation(await customerActor(), booking({ startMinute: 20 * 60 + 30 }))).resolves.toBeTruthy();
    const slots = await getAvailability({ date: DATE, partySize: 4 });
    expect(slots.slots.find((slot) => slot.label === "20:00")).toMatchObject({ available: false, reason: "FULL" });
    expect(slots.slots.find((slot) => slot.label === "17:00")).toMatchObject({ available: true });
  });

  it("allows exactly one booking when many customers race for the last table", async () => {
    await seedTables([4]);
    const customers = await Promise.all(Array.from({ length: 6 }, () => customerActor()));
    const outcomes = await Promise.allSettled(customers.map((customer) => createReservation(customer, booking())));
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    expect(rejected.every((outcome) => outcome.reason instanceof ConflictError)).toBe(true);
    expect(await prisma.reservation.count()).toBe(1);
  });

  it("is protected by a database exclusion constraint even if application checks are bypassed", async () => {
    const [table] = await seedTables([4]);
    const startsAt = zonedTimeToUtc(DATE, 19 * 60, "Asia/Kolkata");
    const endsAt = new Date(startsAt.getTime() + 90 * 60_000);
    const data = {
      tableId: table.id,
      partySize: 2,
      startsAt,
      endsAt,
      status: "CONFIRMED" as const,
      contactName: "X",
      contactPhone: "1234567",
    };
    await prisma.reservation.create({ data: { ...data, code: "AAAA2222" } });
    await expect(
      prisma.reservation.create({
        data: {
          ...data,
          code: "BBBB3333",
          startsAt: new Date(startsAt.getTime() + 30 * 60_000),
          endsAt: new Date(endsAt.getTime() + 30 * 60_000),
        },
      }),
    ).rejects.toThrow();
    // Cancelled bookings do not block the table.
    await prisma.reservation.update({ where: { code: "AAAA2222" }, data: { status: "CANCELLED" } });
    await expect(prisma.reservation.create({ data: { ...data, code: "CCCC4444" } })).resolves.toBeTruthy();
  });

  it("validates party size, slot alignment, closed days and lead time", async () => {
    await seedTables([4]);
    const customer = await customerActor();
    await expect(createReservation(customer, booking({ partySize: 11 }))).rejects.toThrow(/limited to 10/);
    await expect(createReservation(customer, booking({ startMinute: 19 * 60 + 10 }))).rejects.toThrow(/listed reservation times/);
    await expect(createReservation(customer, booking({ startMinute: 22 * 60 }))).rejects.toThrow(ValidationError); // would end after closing
    await expect(createReservation(customer, booking({ date: futureDate(45) }))).rejects.toThrow(/30 days/);
    await prisma.openingHours.updateMany({ data: { isClosed: true } });
    await expect(createReservation(customer, booking())).rejects.toThrow(/closed/);
  });

  it("lets owners modify and cancel, but hides reservations from other customers", async () => {
    await seedTables([2, 6]);
    const owner = await customerActor();
    const stranger = await customerActor();
    const reservation = await createReservation(owner, booking({ partySize: 2 }));
    await expect(
      modifyReservation(stranger, { reservationId: reservation.id, date: DATE, startMinute: 20 * 60, partySize: 2 }),
    ).rejects.toThrow(NotFoundError);
    await expect(cancelReservation(stranger, reservation.id)).rejects.toThrow(NotFoundError);

    const moved = await modifyReservation(owner, { reservationId: reservation.id, date: DATE, startMinute: 20 * 60, partySize: 5 });
    expect(moved.partySize).toBe(5);
    expect((await prisma.restaurantTable.findUniqueOrThrow({ where: { id: moved.tableId } })).capacity).toBe(6);

    await cancelReservation(owner, reservation.id);
    expect((await prisma.reservation.findUniqueOrThrow({ where: { id: reservation.id } })).status).toBe("CANCELLED");
    await expect(cancelReservation(owner, reservation.id)).rejects.toThrow(/no longer be cancelled/);
  });

  it("lets only admins change front-of-house status, with valid transitions and an audit trail", async () => {
    await seedTables([4]);
    const customer = await customerActor();
    const admin = await adminActor();
    const reservation = await createReservation(customer, booking());
    await expect(
      updateReservationStatus(customer, { reservationId: reservation.id, expectedStatus: "CONFIRMED", toStatus: "SEATED" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      updateReservationStatus(admin, { reservationId: reservation.id, expectedStatus: "CONFIRMED", toStatus: "COMPLETED" }),
    ).rejects.toThrow(ForbiddenError);
    await updateReservationStatus(admin, { reservationId: reservation.id, expectedStatus: "CONFIRMED", toStatus: "SEATED" });
    await expect(
      updateReservationStatus(admin, { reservationId: reservation.id, expectedStatus: "CONFIRMED", toStatus: "SEATED" }),
    ).rejects.toThrow(ConflictError);
    await updateReservationStatus(admin, { reservationId: reservation.id, expectedStatus: "SEATED", toStatus: "COMPLETED" });
    expect(await prisma.auditEvent.count({ where: { entityType: "Reservation" } })).toBe(2);
  });
});
