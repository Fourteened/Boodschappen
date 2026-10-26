// Date helpers that work on plain "YYYY-MM-DD" strings, so server (UTC)
// and phone (Europe/Amsterdam) always agree on which day it is.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parse(d: string): Date {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

function format(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isIsoDate(value: string | undefined | null): value is string {
  if (!value || !ISO_DATE.test(value)) return false;
  return format(parse(value)) === value;
}

export function todayInAmsterdam(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function addDays(d: string, n: number): string {
  const x = parse(d);
  x.setUTCDate(x.getUTCDate() + n);
  return format(x);
}

export function mondayOf(d: string): string {
  const x = parse(d);
  const daysSinceMonday = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - daysSinceMonday);
  return format(x);
}

export function isoWeekNumber(d: string): number {
  const x = parse(d);
  // Move to the Thursday of this week; its year decides the ISO week-year.
  x.setUTCDate(x.getUTCDate() + 3 - ((x.getUTCDay() + 6) % 7));
  const jan4 = new Date(Date.UTC(x.getUTCFullYear(), 0, 4));
  const jan4Thursday = new Date(jan4);
  jan4Thursday.setUTCDate(jan4.getUTCDate() + 3 - ((jan4.getUTCDay() + 6) % 7));
  return 1 + Math.round((x.getTime() - jan4Thursday.getTime()) / (7 * 86400000));
}

const dayFormatter = new Intl.DateTimeFormat("nl-NL", { weekday: "long", timeZone: "UTC" });
const dateFormatter = new Intl.DateTimeFormat("nl-NL", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export function weekdayName(d: string): string {
  const name = dayFormatter.format(parse(d));
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function shortDate(d: string): string {
  return dateFormatter.format(parse(d)).replace(".", "");
}
