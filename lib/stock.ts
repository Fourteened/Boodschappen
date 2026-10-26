// Shared types and helpers for the stock (voorraad) screens. Safe for client and server.

export type Location = {
  id: string;
  name: string;
  sort_order: number;
};

export type StockItem = {
  id: string;
  location_id: string | null;
  name: string;
  unit: string | null;
  quantity: number;
  best_before: string | null;
  picnic_article_id: string | null;
  image_id: string | null;
};

export type PicnicLink = {
  status: "awaiting_2fa" | "connected" | "needs_login";
  account_email: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  next_delivery: {
    window_start: string | null;
    window_end: string | null;
    eta_start: string | null;
    eta_end: string | null;
    item_count: number | null;
  } | null;
};

export const STOCK_COLUMNS =
  "id, location_id, name, unit, quantity, best_before, picnic_article_id, image_id";

export function picnicImage(imageId: string | null, size: "tiny" | "small" | "medium" = "small") {
  if (!imageId) return null;
  return `https://storefront-prod.nl.picnicinternational.com/static/images/${imageId}/${size}.png`;
}

function dayNumber(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

/** Days from today until the best-before date (negative = past). */
export function daysLeft(bestBefore: string, today: string) {
  return dayNumber(bestBefore) - dayNumber(today);
}

export function bestBeforeLabel(bestBefore: string, today: string) {
  const days = daysLeft(bestBefore, today);
  if (days < -1) return `${-days} dagen over de datum`;
  if (days === -1) return "Gisteren over de datum";
  if (days === 0) return "Vandaag";
  if (days === 1) return "Morgen";
  if (days <= 6) return `Over ${days} dagen`;
  const [y, m, d] = bestBefore.split("-").map(Number);
  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "short",
    year: y === Number(today.slice(0, 4)) ? undefined : "numeric",
    timeZone: "UTC",
  })
    .format(new Date(Date.UTC(y, m - 1, d)))
    .replace(".", "");
}

export function bestBeforeTone(bestBefore: string, today: string): "past" | "soon" | "ok" {
  const days = daysLeft(bestBefore, today);
  if (days < 0) return "past";
  if (days <= 3) return "soon";
  return "ok";
}

const FREEZER_WORDS = /diepvries|bevroren|ijsjes|\bijs\b|roomijs|frozen/i;

/** Best guess where a Picnic product goes, when we have not seen it before. */
export function guessLocation(
  name: string,
  perishable: boolean,
  locations: Location[],
): string | null {
  const byName = (wanted: string) =>
    locations.find((l) => l.name.toLowerCase() === wanted.toLowerCase())?.id ?? null;
  if (FREEZER_WORDS.test(name)) return byName("Vriezer") ?? locations[0]?.id ?? null;
  if (perishable) return byName("Koelkast") ?? locations[0]?.id ?? null;
  return byName("Voorraadkast") ?? locations[locations.length - 1]?.id ?? null;
}

const timeFormat = new Intl.DateTimeFormat("nl-NL", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Amsterdam",
});
const dayFormat = new Intl.DateTimeFormat("nl-NL", {
  weekday: "long",
  day: "numeric",
  month: "short",
  timeZone: "Europe/Amsterdam",
});

export function formatTime(iso: string) {
  return timeFormat.format(new Date(iso));
}

export function formatDay(iso: string) {
  return dayFormat.format(new Date(iso)).replace(".", "");
}
