import { ReservationStatus, Role } from "@/generated/prisma/enums";
import { ADMIN_ROLES, assertRole, canAccessOwnedRecord, ORDERING_ROLES, type Actor } from "@/lib/auth/permissions";
import { isExclusionViolation, isUniqueViolation, prisma, type Prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { dayOfWeek, zonedDayRange, zonedTimeToUtc } from "@/lib/time";
import { generateCode, humanize } from "@/lib/utils";
import { getHoursForDay, getSettings } from "@/server/repositories/settings-repository";
import { recordAudit } from "@/server/services/audit-service";
import {
  BLOCKING_RESERVATION_STATUSES,
  computeSlots,
  isAlignedSlot,
  validateBookingDate,
  type ReservationRules,
  type SlotResult,
} from "@/server/services/reservation-slots";

export const RESERVATION_FLOW: Record<ReservationStatus, readonly ReservationStatus[]> = {
  PENDING: [ReservationStatus.CONFIRMED, ReservationStatus.CANCELLED],
  CONFIRMED: [ReservationStatus.SEATED, ReservationStatus.CANCELLED, ReservationStatus.NO_SHOW],
  SEATED: [ReservationStatus.COMPLETED],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

const MODIFIABLE: readonly ReservationStatus[] = [ReservationStatus.PENDING, ReservationStatus.CONFIRMED];

async function loadRules(): Promise<ReservationRules & { autoConfirmReservations: boolean }> {
  const settings = await getSettings();
  return {
    timezone: settings.timezone,
    reservationDurationMinutes: settings.reservationDurationMinutes,
    reservationSlotMinutes: settings.reservationSlotMinutes,
    reservationLeadMinutes: settings.reservationLeadMinutes,
    reservationMaxDaysAhead: settings.reservationMaxDaysAhead,
    maxPartySize: settings.maxPartySize,
    autoConfirmReservations: settings.autoConfirmReservations,
  };
}

async function activeTables() {
  return prisma.restaurantTable.findMany({
    where: { isActive: true },
    select: { id: true, label: true, capacity: true },
    orderBy: [{ capacity: "asc" }, { label: "asc" }],
  });
}

/** Lists bookable times for a date and party size, marking unavailable ones. */
export async function getAvailability(
  input: { date: string; partySize: number; excludeReservationId?: string },
  now = new Date(),
): Promise<SlotResult> {
  const rules = await loadRules();
  const hours = await getHoursForDay(dayOfWeek(input.date));
  const tables = await activeTables();
  const { start, end } = zonedDayRange(input.date, rules.timezone);
  const booked = await prisma.reservation.findMany({
    where: {
      status: { in: [...BLOCKING_RESERVATION_STATUSES] },
      startsAt: { lt: end },
      endsAt: { gt: start },
    },
    select: { id: true, tableId: true, startsAt: true, endsAt: true },
  });
  return computeSlots({
    dateISO: input.date,
    partySize: input.partySize,
    now,
    rules,
    hours,
    tables,
    booked,
    excludeReservationId: input.excludeReservationId,
  });
}

async function resolveRequestedSlot(input: { date: string; startMinute: number; partySize: number }, now: Date) {
  const rules = await loadRules();
  if (input.partySize > rules.maxPartySize) {
    throw new ValidationError(`Online bookings are limited to ${rules.maxPartySize} guests. Please call us for larger groups.`, {
      partySize: [`At most ${rules.maxPartySize} guests.`],
    });
  }
  const dateError = validateBookingDate(input.date, rules, now);
  if (dateError) throw new ValidationError(dateError, { date: [dateError] });
  const hours = await getHoursForDay(dayOfWeek(input.date));
  if (!hours || hours.isClosed) throw new ValidationError("The restaurant is closed on that day.", { date: ["Closed on this day."] });
  if (!isAlignedSlot(input.startMinute, hours, rules)) {
    throw new ValidationError("Please choose one of the listed reservation times.", { startMinute: ["Choose a listed time."] });
  }
  const startsAt = zonedTimeToUtc(input.date, input.startMinute, rules.timezone);
  if (startsAt.getTime() < now.getTime() + rules.reservationLeadMinutes * 60_000) {
    throw new ValidationError("That time is too soon to book online. Please choose a later time.", { startMinute: ["Too soon."] });
  }
  const endsAt = new Date(startsAt.getTime() + rules.reservationDurationMinutes * 60_000);
  return { rules, startsAt, endsAt };
}

/**
 * Tries each candidate table inside its own short transaction:
 *   1. lock the table row (SELECT … FOR UPDATE) so concurrent bookings for the
 *      same table are serialised,
 *   2. re-check for overlapping active reservations,
 *   3. write.
 * The database exclusion constraint `reservations_no_overlap` is the final
 * guarantee; if it fires we simply move on to the next table.
 */
async function bookFirstFreeTable<T>(
  candidateTableIds: string[],
  range: { startsAt: Date; endsAt: Date; excludeReservationId?: string },
  write: (tx: Prisma.TransactionClient, tableId: string) => Promise<T | null>,
): Promise<T> {
  for (const tableId of candidateTableIds) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "restaurant_tables" WHERE "id" = ${tableId} AND "isActive" = true FOR UPDATE`;
        const clash = await tx.reservation.count({
          where: {
            tableId,
            status: { in: [...BLOCKING_RESERVATION_STATUSES] },
            startsAt: { lt: range.endsAt },
            endsAt: { gt: range.startsAt },
            ...(range.excludeReservationId ? { id: { not: range.excludeReservationId } } : {}),
          },
        });
        if (clash > 0) return null;
        return write(tx, tableId);
      });
      if (result) return result;
    } catch (error) {
      if (isExclusionViolation(error)) continue;
      throw error;
    }
  }
  throw new ConflictError("Sorry — that time has just been booked. Please choose another time.");
}

export type CreateReservationParams = {
  date: string;
  startMinute: number;
  partySize: number;
  contactName: string;
  contactPhone: string;
  notes?: string;
};

export async function createReservation(actor: Actor, input: CreateReservationParams, now = new Date()) {
  assertRole(actor, ORDERING_ROLES);
  const { rules, startsAt, endsAt } = await resolveRequestedSlot(input, now);
  const tables = (await activeTables()).filter((table) => table.capacity >= input.partySize);
  if (!tables.length) throw new ConflictError(`No table can seat a party of ${input.partySize}. Please call the restaurant.`);

  const status = rules.autoConfirmReservations ? ReservationStatus.CONFIRMED : ReservationStatus.PENDING;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await bookFirstFreeTable(
        tables.map((table) => table.id),
        { startsAt, endsAt },
        (tx, tableId) =>
          tx.reservation.create({
            data: {
              code: generateCode(8),
              customerId: actor.role === Role.CUSTOMER ? actor.id : null,
              tableId,
              partySize: input.partySize,
              startsAt,
              endsAt,
              status,
              contactName: input.contactName,
              contactPhone: input.contactPhone,
              notes: input.notes ?? null,
            },
          }),
      );
    } catch (error) {
      // Extremely unlikely reservation-code collision: retry with a new code.
      if (isUniqueViolation(error) && attempt < 2) continue;
      throw error;
    }
  }
  throw new ConflictError("Could not create the reservation. Please try again.");
}

async function getAccessibleReservation(actor: Actor, reservationId: string) {
  const reservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
  if (!reservation || !canAccessOwnedRecord(actor, reservation.customerId)) throw new NotFoundError("Reservation not found.");
  return reservation;
}

export async function modifyReservation(
  actor: Actor,
  input: { reservationId: string; date: string; startMinute: number; partySize: number; notes?: string },
  now = new Date(),
) {
  assertRole(actor, ORDERING_ROLES);
  const existing = await getAccessibleReservation(actor, input.reservationId);
  if (!MODIFIABLE.includes(existing.status)) throw new ValidationError("Only upcoming reservations can be changed.");
  if (actor.role === Role.CUSTOMER && existing.startsAt <= now) throw new ValidationError("This reservation has already started.");

  const { startsAt, endsAt } = await resolveRequestedSlot(input, now);
  const tables = (await activeTables()).filter((table) => table.capacity >= input.partySize);
  // Prefer keeping the current table when it still fits.
  const ordered = [...tables.filter((table) => table.id === existing.tableId), ...tables.filter((table) => table.id !== existing.tableId)];
  if (!ordered.length) throw new ConflictError(`No table can seat a party of ${input.partySize}.`);

  return bookFirstFreeTable(
    ordered.map((table) => table.id),
    { startsAt, endsAt, excludeReservationId: existing.id },
    async (tx, tableId) => {
      const updated = await tx.reservation.updateMany({
        where: { id: existing.id, status: { in: [...MODIFIABLE] }, updatedAt: existing.updatedAt },
        data: { tableId, startsAt, endsAt, partySize: input.partySize, notes: input.notes ?? existing.notes },
      });
      if (updated.count === 0) throw new ConflictError("This reservation was changed elsewhere. Please refresh and try again.");
      if (actor.role === Role.ADMIN) {
        await recordAudit(tx, {
          actorId: actor.id,
          action: "reservation.modify",
          entityType: "Reservation",
          entityId: existing.id,
          summary: `Changed reservation ${existing.code}`,
          metadata: { from: existing.startsAt.toISOString(), to: startsAt.toISOString(), partySize: input.partySize },
        });
      }
      return tx.reservation.findUniqueOrThrow({ where: { id: existing.id } });
    },
  );
}

export async function cancelReservation(actor: Actor, reservationId: string, now = new Date()) {
  assertRole(actor, ORDERING_ROLES);
  const existing = await getAccessibleReservation(actor, reservationId);
  if (!MODIFIABLE.includes(existing.status)) throw new ValidationError("This reservation can no longer be cancelled.");
  if (actor.role === Role.CUSTOMER && existing.startsAt <= now) {
    throw new ValidationError("This reservation has already started. Please contact the restaurant.");
  }
  await prisma.$transaction(async (tx) => {
    const updated = await tx.reservation.updateMany({
      where: { id: existing.id, status: { in: [...MODIFIABLE] } },
      data: { status: ReservationStatus.CANCELLED, cancelledAt: new Date() },
    });
    if (updated.count === 0) throw new ConflictError("This reservation was already updated. Please refresh.");
    if (actor.role === Role.ADMIN) {
      await recordAudit(tx, {
        actorId: actor.id,
        action: "reservation.cancel",
        entityType: "Reservation",
        entityId: existing.id,
        summary: `Cancelled reservation ${existing.code}`,
      });
    }
  });
}

/** Front-of-house status changes (seat, complete, no-show, confirm). */
export async function updateReservationStatus(
  actor: Actor,
  input: { reservationId: string; expectedStatus: ReservationStatus; toStatus: ReservationStatus },
) {
  assertRole(actor, ADMIN_ROLES);
  if (!RESERVATION_FLOW[input.expectedStatus].includes(input.toStatus)) {
    throw new ForbiddenError(
      `A ${humanize(input.expectedStatus).toLowerCase()} reservation cannot become ${humanize(input.toStatus).toLowerCase()}.`,
    );
  }
  await prisma.$transaction(async (tx) => {
    const updated = await tx.reservation.updateMany({
      where: { id: input.reservationId, status: input.expectedStatus },
      data: {
        status: input.toStatus,
        ...(input.toStatus === ReservationStatus.CANCELLED ? { cancelledAt: new Date() } : {}),
      },
    });
    if (updated.count === 0) {
      const current = await tx.reservation.findUnique({ where: { id: input.reservationId }, select: { status: true } });
      if (!current) throw new NotFoundError("Reservation not found.");
      throw new ConflictError(`This reservation is already ${humanize(current.status).toLowerCase()}. Please refresh.`);
    }
    const reservation = await tx.reservation.findUniqueOrThrow({ where: { id: input.reservationId } });
    await recordAudit(tx, {
      actorId: actor.id,
      action: "reservation.status",
      entityType: "Reservation",
      entityId: reservation.id,
      summary: `Reservation ${reservation.code}: ${input.expectedStatus} → ${input.toStatus}`,
    });
  });
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export async function getReservationForActor(actor: Actor, reservationId: string) {
  const reservation = await prisma.reservation.findUnique({
    where: { id: reservationId },
    include: { table: { select: { label: true, capacity: true } } },
  });
  if (!reservation || !canAccessOwnedRecord(actor, reservation.customerId)) throw new NotFoundError("Reservation not found.");
  return reservation;
}

export async function listReservationsForCustomer(actor: Actor) {
  return prisma.reservation.findMany({
    where: { customerId: actor.id },
    orderBy: { startsAt: "desc" },
    take: 50,
    include: { table: { select: { label: true } } },
  });
}

export async function listReservationsForAdmin(
  actor: Actor,
  filters: { date?: string; status?: ReservationStatus; q?: string; page: number },
  pageSize = 25,
) {
  assertRole(actor, ADMIN_ROLES);
  const settings = await getSettings();
  const where: Prisma.ReservationWhereInput = {};
  if (filters.date) {
    const { start, end } = zonedDayRange(filters.date, settings.timezone);
    where.startsAt = { gte: start, lt: end };
  }
  if (filters.status) where.status = filters.status;
  if (filters.q) {
    where.OR = [
      { code: { contains: filters.q.toUpperCase() } },
      { contactName: { contains: filters.q, mode: "insensitive" } },
      { contactPhone: { contains: filters.q } },
    ];
  }
  const [reservations, total] = await Promise.all([
    prisma.reservation.findMany({
      where,
      orderBy: { startsAt: filters.date ? "asc" : "desc" },
      skip: (filters.page - 1) * pageSize,
      take: pageSize,
      include: { table: { select: { label: true, capacity: true } }, customer: { select: { email: true } } },
    }),
    prisma.reservation.count({ where }),
  ]);
  return { reservations, total, page: filters.page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}
