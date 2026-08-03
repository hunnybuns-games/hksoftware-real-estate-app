/**
 * All money in this app is integer cents. These helpers are the only sanctioned
 * way in and out of that representation.
 */

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const currencyWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatCents(cents: number): string {
  return currency.format(cents / 100);
}

/** For dashboard tiles where cents are noise. */
export function formatCentsShort(cents: number): string {
  return cents % 100 === 0
    ? currencyWhole.format(cents / 100)
    : currency.format(cents / 100);
}

/**
 * Parse user input ("1,250", "$1250.50", "1250") into cents.
 * Returns null for anything that isn't a clean non-negative dollar amount.
 */
export function parseDollarsToCents(input: string | number): number | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) return null;
    return Math.round(input * 100);
  }
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** Dollars string suitable for prefilling a text input. */
export function centsToInputValue(cents: number): string {
  return (cents / 100).toFixed(2);
}
