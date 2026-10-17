import { ReservationStatus } from "@/generated/prisma/enums";
import { addDaysISO, dayOfWeek, minutesToHHMM, zonedDateISO, zonedTimeToUtc } from "@/lib/time";

/** Reservation statuses that occupy a table. Must match the DB exclusion constraint. */
export const BLOCKING_RESERVATION_STATUSES: readonly ReservationStatus[] = [
  ReservationStatus.PENDING,
  ReservationStatus.CONFIRMED,
  ReservationStatus.SEATED,
];

export type ReservationRules = {
  timezone: string;
  reservationDurationMinutes: number;
  reservationSlotMinutes: number;
  reservationLeadMinutes: number;
  reservationMaxDaysAhead: number;
  maxPartySize: number;
};

export type DayHours = { isClosed: boolean; openMinute: number; closeMinute: number } | null;
export type TableCapacity = { id: string; label: string; capacity: number };
export type BookedRange = { id?: string; tableId: string; startsAt: Date; endsAt: Date };

export type Slot = {
  startMinute: number;
  label: string;
  startsAt: string;
  available: boolean;
  reason?: "PAST" | "FULL";
};

export type SlotResult = { slots: Slot[]; unavailableReason?: string };

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Tables that fit the party and are free for the range, smallest first. */
export function freeTablesFor(
  tables: TableCapacity[],
  booked: BookedRange[],
  partySize: number,
  startsAt: Date,
  endsAt: Date,
  excludeReservationId?: string,
): TableCapacity[] {
  return tables
    .filter((table) => table.capacity >= partySize)
    .filter(
      (table) =>
        !booked.some(
          (range) =>
            range.tableId === table.id &&
            (excludeReservationId === undefined || range.id !== excludeReservationId) &&
            overlaps(range.startsAt, range.endsAt, startsAt, endsAt),
        ),
    )
    .sort((a, b) => a.capacity - b.capacity || a.label.localeCompare(b.label));
}

/** Validates the requested date against the booking window; returns an error message or null. */
export function validateBookingDate(dateISO: string, rules: ReservationRules, now: Date): string | null {
  const today = zonedDateISO(now, rules.timezone);
  if (dateISO < today) return "That date is in the past.";
  const lastDay = addDaysISO(today, rules.reservationMaxDaysAhead);
  if (dateISO > lastDay) return `Reservations can be made up to ${rules.reservationMaxDaysAhead} days ahead.`;
  return null;
}

/**
 * Lists every bookable start time for a date, marking which are available.
 * Pure: callers pass tables, existing bookings and opening hours.
 */
export function computeSlots(params: {
  dateISO: string;
  partySize: number;
  now: Date;
  rules: ReservationRules;
  hours: DayHours;
  tables: TableCapacity[];
  booked: BookedRange[];
  excludeReservationId?: string;
}): SlotResult {
  const { dateISO, partySize, now, rules, hours, tables, booked, excludeReservationId } = params;

  if (partySize < 1 || partySize > rules.maxPartySize) {
    return { slots: [], unavailableReason: `Online bookings are available for 1–${rules.maxPartySize} guests.` };
  }
  const dateError = validateBookingDate(dateISO, rules, now);
  if (dateError) return { slots: [], unavailableReason: dateError };
  if (!hours || hours.isClosed) return { slots: [], unavailableReason: "The restaurant is closed on this day." };
  if (!tables.some((table) => table.capacity >= partySize)) {
    return { slots: [], unavailableReason: `No table can seat a party of ${partySize}. Please call us.` };
  }

  const earliest = now.getTime() + rules.reservationLeadMinutes * 60_000;
  const slots: Slot[] = [];
  for (
    let minute = hours.openMinute;
    minute + rules.reservationDurationMinutes <= hours.closeMinute;
    minute += rules.reservationSlotMinutes
  ) {
    const startsAt = zonedTimeToUtc(dateISO, minute, rules.timezone);
    const endsAt = new Date(startsAt.getTime() + rules.reservationDurationMinutes * 60_000);
    const base = { startMinute: minute, label: minutesToHHMM(minute), startsAt: startsAt.toISOString() };
    if (startsAt.getTime() < earliest) {
      slots.push({ ...base, available: false, reason: "PAST" });
      continue;
    }
    const free = freeTablesFor(tables, booked, partySize, startsAt, endsAt, excludeReservationId);
    slots.push(free.length ? { ...base, available: true } : { ...base, available: false, reason: "FULL" });
  }

  if (!slots.length) return { slots, unavailableReason: "No reservation times fit within today's opening hours." };
  return { slots };
}

/** Validates that a requested start time is a real slot for the day. */
export function isAlignedSlot(startMinute: number, hours: DayHours, rules: ReservationRules): boolean {
  if (!hours || hours.isClosed) return false;
  if (startMinute < hours.openMinute) return false;
  if (startMinute + rules.reservationDurationMinutes > hours.closeMinute) return false;
  return (startMinute - hours.openMinute) % rules.reservationSlotMinutes === 0;
}

export { dayOfWeek };
