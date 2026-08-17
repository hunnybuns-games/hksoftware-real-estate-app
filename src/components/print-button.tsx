"use client";

/** Opens the browser's print dialog — the "Download as PDF" path for a lease document (see docs/lease-signing.md). */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="btn-secondary print:hidden">
      Print / Save as PDF
    </button>
  );
}
