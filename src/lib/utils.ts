import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatOrderNumber(orderNumber: number): string {
  return `DD-${String(orderNumber).padStart(6, "0")}`;
}

export function formatDateTime(date: Date | string, timeZone: string, locale = "en-IN"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
}

export function formatDate(date: Date | string, timeZone: string, locale = "en-IN"): string {
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium" }).format(new Date(date));
}

export function formatTime(date: Date | string, timeZone: string, locale = "en-IN"): string {
  return new Intl.DateTimeFormat(locale, { timeZone, timeStyle: "short" }).format(new Date(date));
}

export function minutesBetween(from: Date | string, to: Date | string = new Date()): number {
  return Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

// Crockford-style alphabet without ambiguous characters (0/O, 1/I/L).
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Cryptographically random human-friendly code, e.g. for reservation references. */
export function generateCode(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let output = "";
  for (const byte of bytes) output += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return output;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function humanize(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Reads a single string value from Next.js searchParams. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
