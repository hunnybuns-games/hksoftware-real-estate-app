import { fromDateInputValue } from "@/lib/dates";
import { parseDollarsToCents } from "@/lib/money";

/**
 * Column auto-detection for imported statements. Bank/Venmo/Cash App/HAP
 * exports all use slightly different header names for the same four things
 * (when, how much, what it was, who sent it) — this guesses a mapping from
 * common header spellings, and the review screen lets staff correct it when
 * a file doesn't match any of them.
 */

export type ColumnMapping = {
  dateColumn: string | null;
  amountColumn: string | null;
  descriptionColumn: string | null;
  payerColumn: string | null;
  refColumn: string | null;
};

const DATE_HEADERS = ["date", "transaction date", "posted date", "post date", "txn date"];
const DESCRIPTION_HEADERS = ["description", "memo", "note", "notes", "details", "transaction description"];
const PAYER_HEADERS = ["payer", "payee", "name", "from", "sender", "counterparty", "other party", "tenant"];
const REF_HEADERS = ["reference", "ref", "transaction id", "id", "confirmation", "check number", "check #"];

// Checking-account exports often split money into separate Debit/Credit
// columns rather than one signed Amount column. We only ever want money
// coming IN, so when both exist, Credit wins outright — Debit is never a
// candidate for the amount column.
const CREDIT_HEADERS = ["credit", "deposit", "amount received", "credit amount"];
const AMOUNT_HEADERS = ["amount", "amt", "transaction amount", "payment amount", "total"];
const DEBIT_HEADERS = ["debit", "withdrawal", "debit amount"];

function normalize(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

function findHeader(headers: string[], candidates: string[]): string | null {
  const normalized = headers.map(normalize);
  for (const candidate of candidates) {
    const idx = normalized.indexOf(candidate);
    if (idx !== -1) return headers[idx];
  }
  // Loose fallback: a header that *contains* one of the candidate words.
  for (const candidate of candidates) {
    const idx = normalized.findIndex((h) => h.includes(candidate));
    if (idx !== -1) return headers[idx];
  }
  return null;
}

export function guessColumnMapping(headers: string[]): ColumnMapping {
  const credit = findHeader(headers, CREDIT_HEADERS);
  const debitPresent = findHeader(headers, DEBIT_HEADERS) !== null;
  // Prefer a dedicated Credit column over a generic Amount column whenever
  // both exist (the generic Amount alongside Debit/Credit is usually just a
  // running balance, not a transaction amount).
  const amountColumn = credit ?? (debitPresent ? null : findHeader(headers, AMOUNT_HEADERS));

  return {
    dateColumn: findHeader(headers, DATE_HEADERS),
    amountColumn: amountColumn ?? findHeader(headers, AMOUNT_HEADERS),
    descriptionColumn: findHeader(headers, DESCRIPTION_HEADERS),
    payerColumn: findHeader(headers, PAYER_HEADERS),
    refColumn: findHeader(headers, REF_HEADERS),
  };
}

export type ParsedImportRow = {
  rowIndex: number;
  date: Date | null;
  amountCents: number | null;
  description: string;
  payerRaw: string;
  externalRef: string | null;
  /** Raw error text when date/amount couldn't be parsed at all. */
  parseError: string | null;
};

/**
 * Applies a column mapping to raw CSV rows, parsing dates and amounts. Rows
 * that fail to parse a date or a usable amount are kept (with parseError set)
 * rather than silently dropped, so the review screen can show *why* a row is
 * being skipped instead of a mysteriously shorter table.
 */
export function applyColumnMapping(
  headers: string[],
  rows: string[][],
  mapping: ColumnMapping,
): ParsedImportRow[] {
  const indexOf = (col: string | null) => (col ? headers.indexOf(col) : -1);
  const dateIdx = indexOf(mapping.dateColumn);
  const amountIdx = indexOf(mapping.amountColumn);
  const descIdx = indexOf(mapping.descriptionColumn);
  const payerIdx = indexOf(mapping.payerColumn);
  const refIdx = indexOf(mapping.refColumn);

  return rows.map((row, rowIndex) => {
    const rawDate = dateIdx >= 0 ? (row[dateIdx] ?? "").trim() : "";
    const rawAmount = amountIdx >= 0 ? (row[amountIdx] ?? "").trim() : "";
    const description = descIdx >= 0 ? (row[descIdx] ?? "").trim() : "";
    const payerRaw = payerIdx >= 0 ? (row[payerIdx] ?? "").trim() : "";
    const externalRef = refIdx >= 0 ? (row[refIdx] ?? "").trim() || null : null;

    const date = parseImportDate(rawDate);
    const amountCents = rawAmount === "" ? null : parseDollarsToCents(rawAmount.replace(/^-/, ""));

    let parseError: string | null = null;
    if (!date) parseError = `Couldn't read a date from "${rawDate}"`;
    else if (amountCents === null) parseError = `Couldn't read an amount from "${rawAmount}"`;
    // A negative amount in a single-column export is money leaving the
    // account (a withdrawal or transfer out) — never a rent payment in.
    else if (rawAmount.trim().startsWith("-")) parseError = "Negative amount — not incoming money";
    else if (amountCents === 0) parseError = "Zero amount";

    return { rowIndex, date, amountCents, description, payerRaw, externalRef, parseError };
  });
}

/** Accepts common export date shapes: ISO, US slash, and US dash. */
function parseImportDate(raw: string): Date | null {
  if (!raw) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return fromDateInputValue(iso[0].slice(0, 10));

  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(raw);
  if (slash) {
    const [, m, d, y] = slash;
    const year = y.length === 2 ? `20${y}` : y;
    return fromDateInputValue(`${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
  }

  return null;
}
