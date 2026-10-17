/**
 * Time-zone helpers built on Intl (no external dependency). Restaurant opening
 * hours and reservation slots are defined in the restaurant's IANA time zone
 * and converted to UTC instants for storage.
 */
export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAYS.indexOf(get("weekday")),
  };
}

function offsetMs(date: Date, timeZone: string): number {
  const p = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = Math.floor(date.getTime() / 1000) * 1000;
  return asUtc - truncated;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseISODate(dateISO: string): { year: number; month: number; day: number } {
  const match = DATE_RE.exec(dateISO);
  if (!match) throw new Error(`Invalid date: ${dateISO}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new Error(`Invalid date: ${dateISO}`);
  }
  return { year, month, day };
}

export function isValidISODate(dateISO: string): boolean {
  try {
    parseISODate(dateISO);
    return true;
  } catch {
    return false;
  }
}

/** Converts a wall-clock time in `timeZone` (date + minutes after midnight) to a UTC instant. */
export function zonedTimeToUtc(dateISO: string, minuteOfDay: number, timeZone: string): Date {
  const { year, month, day } = parseISODate(dateISO);
  const guess = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  const firstOffset = offsetMs(new Date(guess), timeZone);
  let result = guess - firstOffset;
  const secondOffset = offsetMs(new Date(result), timeZone);
  if (secondOffset !== firstOffset) result = guess - secondOffset;
  return new Date(result);
}

/** The calendar date ("YYYY-MM-DD") of an instant in `timeZone`. */
export function zonedDateISO(date: Date, timeZone: string): string {
  const p = getZonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Minutes after local midnight of an instant in `timeZone`. */
export function zonedMinuteOfDay(date: Date, timeZone: string): number {
  const p = getZonedParts(date, timeZone);
  return p.hour * 60 + p.minute;
}

/** 0 = Sunday … 6 = Saturday, for a calendar date. */
export function dayOfWeek(dateISO: string): number {
  const { year, month, day } = parseISODate(dateISO);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function addDaysISO(dateISO: string, days: number): string {
  const { year, month, day } = parseISODate(dateISO);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function hhmmToMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-4]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes > 1440 ? null : minutes;
}

/** Start/end UTC instants covering a local calendar day in `timeZone`. */
export function zonedDayRange(dateISO: string, timeZone: string): { start: Date; end: Date } {
  return {
    start: zonedTimeToUtc(dateISO, 0, timeZone),
    end: zonedTimeToUtc(addDaysISO(dateISO, 1), 0, timeZone),
  };
}
