/**
 * Minimal RFC 4180 CSV parser/writer. No dependency — bank/Venmo/CashApp/HAP
 * exports and our own reports are small (hundreds to low thousands of rows),
 * so a hand-rolled parser is plenty and keeps this app's "swap for a real
 * export later" story simple (it's just strings in, strings out).
 *
 * Handles: quoted fields, commas and newlines inside quotes, escaped quotes
 * ("" inside a quoted field), \r\n and \n line endings, and a trailing
 * newline (or not).
 */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Normalize line endings up front so the state machine only deals with \n.
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }

  // Flush the last field/row if the file doesn't end with a newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully-blank trailing rows some exporters append.
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === "")) {
    rows.pop();
  }

  return rows;
}

export type CsvTable = { headers: string[]; rows: string[][] };

/** Parses with the first row treated as headers. */
export function parseCsvWithHeader(text: string): CsvTable {
  const all = parseCsv(text);
  const [headers = [], ...rows] = all;
  return { headers: headers.map((h) => h.trim()), rows };
}

function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Builds a CSV string from column definitions + rows. Used by every export
 * in the app (reports, rent roll, statements) so the quoting rules only live
 * in one place.
 */
export function toCsv<T>(rows: T[], columns: { header: string; value: (row: T) => string | number }[]): string {
  const headerLine = columns.map((c) => escapeCsvField(c.header)).join(",");
  const lines = rows.map((row) =>
    columns.map((c) => escapeCsvField(String(c.value(row)))).join(","),
  );
  // \r\n is the RFC-4180 line ending and what Excel expects; plain \n also
  // works everywhere else, so there's no real downside to being strict here.
  return [headerLine, ...lines].join("\r\n") + "\r\n";
}

/**
 * Wraps a CSV string as a downloadable response. Every export route in the
 * app returns through this, so the headers (and the "this is a file, not a
 * page" behavior) are consistent everywhere.
 */
export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
