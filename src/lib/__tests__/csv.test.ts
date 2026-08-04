import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvWithHeader, toCsv } from "@/lib/csv";

describe("parseCsv", () => {
  it("parses a plain comma-separated file", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields containing commas", () => {
    expect(parseCsv('name,memo\nJane,"Rent, June"\n')).toEqual([
      ["name", "memo"],
      ["Jane", "Rent, June"],
    ]);
  });

  it("handles escaped quotes inside quoted fields", () => {
    expect(parseCsv('note\n"She said ""hi"""\n')).toEqual([["note"], ['She said "hi"']]);
  });

  it("handles quoted fields containing newlines", () => {
    expect(parseCsv('memo\n"line one\nline two"\n')).toEqual([["memo"], ["line one\nline two"]]);
  });

  it("handles CRLF line endings, common in bank exports", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("works without a trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("drops trailing blank rows", () => {
    expect(parseCsv("a,b\n1,2\n\n\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("parses an empty file to no rows", () => {
    expect(parseCsv("")).toEqual([]);
  });
});

describe("parseCsvWithHeader", () => {
  it("splits the header from the data rows", () => {
    const { headers, rows } = parseCsvWithHeader("Date,Amount,Description\n2026-01-01,100,Rent\n");
    expect(headers).toEqual(["Date", "Amount", "Description"]);
    expect(rows).toEqual([["2026-01-01", "100", "Rent"]]);
  });

  it("trims whitespace from header names", () => {
    const { headers } = parseCsvWithHeader(" Date , Amount \n1,2\n");
    expect(headers).toEqual(["Date", "Amount"]);
  });
});

describe("toCsv", () => {
  it("round-trips through parseCsv", () => {
    const rows = [
      { name: "Jane, A.", note: 'She said "hi"' },
      { name: "Multi\nLine", note: "plain" },
    ];
    const csv = toCsv(rows, [
      { header: "Name", value: (r) => r.name },
      { header: "Note", value: (r) => r.note },
    ]);
    const parsed = parseCsvWithHeader(csv);
    expect(parsed.headers).toEqual(["Name", "Note"]);
    expect(parsed.rows).toEqual([
      ["Jane, A.", 'She said "hi"'],
      ["Multi\nLine", "plain"],
    ]);
  });

  it("quotes only fields that need it", () => {
    const csv = toCsv([{ a: "plain", b: "has,comma" }], [
      { header: "A", value: (r) => r.a },
      { header: "B", value: (r) => r.b },
    ]);
    expect(csv).toBe('A,B\r\nplain,"has,comma"\r\n');
  });
});
