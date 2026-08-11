/**
 * Date handling rules for this app:
 *
 * Lease dates, charge due dates and rent periods are *calendar* dates, not
 * instants. We normalise every one of them to midnight UTC so that a landlord
 * in Hawaii and a server in Frankfurt agree on which month rent is due. Never
 * build these with `new Date(y, m, d)` — that uses the machine's local zone.
 */

export function utcDate(year: number, month1to12: number, day: number): Date {
  return new Date(Date.UTC(year, month1to12 - 1, day, 0, 0, 0, 0));
}

/** Strips the time component, keeping the UTC calendar day. */
export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function startOfUtcMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function addUtcMonths(d: Date, months: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()));
}

export function addUtcDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

export function daysBetweenUtc(a: Date, b: Date): number {
  return Math.round((startOfUtcDay(b).getTime() - startOfUtcDay(a).getTime()) / 86_400_000);
}

/**
 * The day rent is due inside a given month. `rentDueDay` is clamped to 1-28 at
 * write time, so no month-length edge cases here.
 */
export function rentDueDateFor(periodStart: Date, rentDueDay: number): Date {
  const day = Math.min(Math.max(rentDueDay, 1), 28);
  return utcDate(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, day);
}

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const monthFmt = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

export function formatDate(d: Date | null | undefined): string {
  return d ? dateFmt.format(d) : "—";
}

export function formatMonth(d: Date): string {
  return monthFmt.format(d);
}

export function formatDateTime(d: Date | null | undefined): string {
  return d ? `${dateTimeFmt.format(d)} UTC` : "—";
}

/** `yyyy-mm-dd` for <input type="date"> round-tripping. */
export function toDateInputValue(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

/** Parses `yyyy-mm-dd` from a date input into midnight UTC. */
export function fromDateInputValue(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = utcDate(Number(m[1]), Number(m[2]), Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A day of the month as an ordinal — "1st", "22nd", "3rd". Only ever used for
 * a lease's rentDueDay, which is clamped to 1-28, but the teens are handled
 * anyway so the function is correct on its own terms rather than only inside
 * that range.
 */
export function ordinalDay(n: number): string {
  const suffix =
    n % 10 === 1 && n % 100 !== 11
      ? "st"
      : n % 10 === 2 && n % 100 !== 12
        ? "nd"
        : n % 10 === 3 && n % 100 !== 13
          ? "rd"
          : "th";
  return `${n}${suffix}`;
}

export function relativeDays(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}
