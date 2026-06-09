import { format, addDays } from "date-fns";

export function getTodayStr(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function getNext14Days(): string[] {
  const days: string[] = [];
  for (let i = 0; i <= 14; i++) {
    days.push(format(addDays(new Date(), i), "yyyy-MM-dd"));
  }
  return days;
}

export function formatDateDisplay(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return format(d, "EEE, MMM d yyyy");
}
