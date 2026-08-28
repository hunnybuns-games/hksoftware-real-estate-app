import type { DocumentCategory } from "@prisma/client";
import { suggestLeaseMatch, type MatchableLease } from "@/lib/lease-matching";
import type { FileFamily } from "@/lib/file-signature";

/**
 * Guesses where a dropped file belongs — what kind of document it is, and
 * which property or lease it concerns — from its filename.
 *
 * Same philosophy as src/lib/lease-matching.ts, which this reuses for the
 * "which lease?" half: explainable keyword scoring rather than anything
 * fuzzy, and ambiguity always loses to leaving it for a human. Every
 * suggestion here lands on a review screen before it is saved, so a wrong
 * guess costs one dropdown change; a wrong *silent* filing would bury a
 * signed lease under the wrong tenant, which is much worse than an unsorted
 * pile.
 *
 * Filenames are the only signal used. Reading inside the file — OCR on a
 * scanned lease, parsing a PDF's text layer — would be far stronger and is
 * deliberately not attempted here: it needs a document-AI dependency and a
 * per-page cost model, and nothing about this module's interface has to
 * change to add it later as a second opinion.
 */

/**
 * Keyword weights per category. Multi-word phrases score higher than single
 * words because they are far less likely to appear by accident: "certificate
 * of insurance" is decisive, whereas a bare "policy" could be anything.
 */
const CATEGORY_KEYWORDS: Record<Exclude<DocumentCategory, "OTHER" | "PHOTO">, [string, number][]> = {
  LEASE: [
    ["lease agreement", 6],
    ["rental agreement", 6],
    ["lease renewal", 6],
    ["month to month", 5],
    ["addendum", 4],
    ["amendment", 3],
    ["sublease", 5],
    ["tenancy", 4],
    ["lease", 3],
  ],
  APPLICATION: [
    ["rental application", 6],
    ["background check", 6],
    ["credit report", 6],
    ["screening", 5],
    ["applicant", 4],
    ["application", 3],
  ],
  INSURANCE: [
    ["certificate of insurance", 7],
    ["renters insurance", 6],
    ["proof of insurance", 6],
    ["liability", 4],
    ["insurance", 4],
    ["policy", 2],
    ["coi", 3],
  ],
  TAX: [
    ["property tax", 6],
    ["schedule e", 5],
    ["1099", 5],
    ["w9", 5],
    ["tax", 3],
  ],
  INSPECTION: [
    ["move in inspection", 7],
    ["move out inspection", 7],
    ["condition report", 6],
    ["walkthrough", 5],
    ["walk through", 5],
    ["punch list", 5],
    ["inspection", 4],
    ["move in", 3],
    ["move out", 3],
  ],
  RECEIPT: [
    ["work order", 5],
    ["receipt", 4],
    ["invoice", 4],
    ["estimate", 3],
    ["quote", 2],
    ["bill", 2],
  ],
  IDENTIFICATION: [
    ["drivers license", 6],
    ["driver license", 6],
    ["proof of income", 6],
    ["pay stub", 5],
    ["paystub", 5],
    ["passport", 5],
    ["photo id", 5],
  ],
  NOTICE: [
    ["notice to vacate", 7],
    ["notice to quit", 7],
    ["eviction", 6],
    ["late notice", 6],
    ["lease violation", 6],
    ["entry notice", 5],
    ["demand", 3],
    ["notice", 3],
  ],
  STATEMENT: [
    ["owner statement", 6],
    ["bank statement", 6],
    ["rent roll", 6],
    ["rentroll", 6],
    ["statement", 3],
    ["ledger", 4],
  ],
};

/**
 * Filenames are rarely prose: "Smith_Lease_2024-01.pdf",
 * "unit4B-moveout.PDF". Separators become spaces so multi-word phrases above
 * can match regardless of which one the file happened to use.
 */
export function normalizeFilename(filename: string): string {
  return filename
    .replace(/\.[a-z0-9]+$/i, "") // drop the extension, never a content signal
    .toLowerCase()
    // A hyphen with a digit on either side joins one token rather than
    // separating two: "W-9" is "w9", "3-day" is "3day". Spacing those apart
    // like an ordinary separator is what made "W-9 Reyes.pdf" miss the TAX
    // keywords entirely. Hyphens between words ("move-in", "walk-through")
    // still become spaces below, so multi-word phrases keep matching.
    .replace(/(?<=\d)-(?=[a-z0-9])|(?<=[a-z0-9])-(?=\d)/g, "")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function guessDocumentCategory(filename: string, family: FileFamily): DocumentCategory {
  const text = normalizeFilename(filename);

  let best: { category: DocumentCategory; score: number } | null = null;
  let runnerUp = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const [keyword, weight] of keywords) {
      if (text.includes(keyword)) score += weight;
    }
    if (score === 0) continue;

    if (!best || score > best.score) {
      runnerUp = best?.score ?? 0;
      best = { category: category as DocumentCategory, score };
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  // A tie is genuine ambiguity ("lease application.pdf" reads both ways) —
  // fall back rather than pick arbitrarily, and let the human decide.
  if (best && best.score > runnerUp) return best.category;

  // No keyword landed. An image with nothing else to go on is a photo; a
  // spreadsheet is almost always some kind of statement or rent roll.
  if (best === null && family === "image") return "PHOTO";
  if (best === null && family === "spreadsheet") return "STATEMENT";
  return "OTHER";
}

export type FilingCandidates = {
  leases: MatchableLease[];
  properties: { propertyId: string; name: string }[];
};

export type FilingSuggestion = {
  category: DocumentCategory;
  /** Set when one lease is unambiguously the best fit; callers expand this to unit/tenant/property. */
  leaseId: string | null;
  /** Only consulted when no lease matched — a property-level filing. */
  propertyId: string | null;
};

export function suggestFiling(
  filename: string,
  family: FileFamily,
  candidates: FilingCandidates,
): FilingSuggestion {
  const category = guessDocumentCategory(filename, family);
  const text = normalizeFilename(filename);

  // Lease matching is the existing, tested scorer — tenant name, unit label
  // and property name, with ties rejected. Reused rather than reimplemented
  // so bank-import matching and document filing can never drift apart.
  const lease = suggestLeaseMatch(text, candidates.leases);
  if (lease) return { category, leaseId: lease.leaseId, propertyId: null };

  // No lease matched. A property name in the filename still narrows it
  // usefully — property insurance and tax bills belong at that level anyway.
  let bestProperty: { propertyId: string; score: number } | null = null;
  let runnerUp = 0;
  for (const property of candidates.properties) {
    const words = normalizeFilename(property.name)
      .split(" ")
      .filter((w) => w.length > 2);
    if (words.length === 0) continue;

    const score = words.reduce((total, word) => (text.includes(word) ? total + word.length : total), 0);
    if (score === 0) continue;

    if (!bestProperty || score > bestProperty.score) {
      runnerUp = bestProperty?.score ?? 0;
      bestProperty = { propertyId: property.propertyId, score };
    } else if (score > runnerUp) {
      runnerUp = score;
    }
  }

  const propertyId = bestProperty && bestProperty.score > runnerUp ? bestProperty.propertyId : null;
  return { category, leaseId: null, propertyId };
}
