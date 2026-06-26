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

/** Return the current local hour (0–23) in the store's timezone. */
function localHourNow(): number {
  return parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz(),
      hour: "numeric",
      hour12: false,
    }).format(new Date()),
    10
  );
}

export function getTodayStr(): string {
  return localDateStr(new Date());
}

/**
 * Returns the current "business day" as YYYY-MM-DD.
 *
 * The store runs 10am–midnight. Any time before BUSINESS_DAY_CUTOFF_HOUR
 * (3am) is treated as belonging to the *previous* calendar day, so a
 * close-shift submission at 12:30am Tuesday is dated Monday — the same
 * date as the Open and Mid shifts that day.
 *
 * Safe to use everywhere staff and admin need "today's" date.
 * The admin extra-task date picker uses explicit chosen dates, not this.
 */
const BUSINESS_DAY_CUTOFF_HOUR = 3;

export function getBusinessDayStr(): string {
  const now = new Date();
  if (localHourNow() < BUSINESS_DAY_CUTOFF_HOUR) {
    // Still the previous business day — subtract 24 h
    return localDateStr(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  }
  return localDateStr(now);
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
