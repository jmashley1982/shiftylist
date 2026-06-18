import { format, addDays } from "date-fns";

/** The store's configured timezone (defaults to America/Chicago). Set STORE_TIMEZONE env var to override. */
function tz(): string {
  return process.env.STORE_TIMEZONE ?? "America/Chicago";
}

/** Format a Date to YYYY-MM-DD in the store's local timezone. */
function localDateStr(d: Date): string {
  // en-CA locale produces ISO-style YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz() }).format(d);
}

export function getTodayStr(): string {
  return localDateStr(new Date());
}

export function getUpcomingDays(n = 14): string[] {
  const days: string[] = [];
  const base = new Date();
  for (let i = 0; i < n; i++) {
    days.push(localDateStr(addDays(base, i)));
  }
  return days;
}

/** @deprecated use getUpcomingDays */
export function getNext14Days(): string[] {
  return getUpcomingDays(15);
}

export function formatDateDisplay(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return format(d, "EEE, MMM d");
}

export function formatDateFull(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return format(d, "EEE, MMM d yyyy");
}

/**
 * Format a UTC timestamp as a human-readable time in the store's local timezone.
 * Use this anywhere a timestamp from the database needs to be shown to staff/admin.
 */
export function formatLocalTime(date: Date | string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz(),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(date));
}
