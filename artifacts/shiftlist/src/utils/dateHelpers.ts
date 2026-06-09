import { format, addDays } from "date-fns";

export function getTodayStr(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function getUpcomingDays(n = 14): string[] {
  const days: string[] = [];
  for (let i = 0; i < n; i++) {
    days.push(format(addDays(new Date(), i), "yyyy-MM-dd"));
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
