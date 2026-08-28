import type { DocumentCategory } from "@prisma/client";

/**
 * Human labels for DocumentCategory, in one place because both the server
 * page and the client refile form need them and a client component cannot
 * import from a "use server" module.
 *
 * Insertion order is the order they appear in the picker: the categories a
 * landlord files most often first, OTHER last.
 */
export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  LEASE: "Lease",
  APPLICATION: "Application",
  INSURANCE: "Insurance",
  INSPECTION: "Inspection",
  RECEIPT: "Receipt / invoice",
  STATEMENT: "Statement",
  NOTICE: "Notice",
  TAX: "Tax",
  IDENTIFICATION: "ID / income",
  PHOTO: "Photo",
  OTHER: "Other",
};

/** Badge tone per category, so the list scans by colour rather than by reading. */
export const DOCUMENT_CATEGORY_TONES: Record<DocumentCategory, "slate" | "blue" | "green" | "amber" | "red" | "neutral"> = {
  LEASE: "blue",
  APPLICATION: "blue",
  INSURANCE: "green",
  INSPECTION: "neutral",
  RECEIPT: "neutral",
  STATEMENT: "green",
  // The two that usually mean something needs attention.
  NOTICE: "red",
  TAX: "amber",
  IDENTIFICATION: "amber",
  PHOTO: "slate",
  OTHER: "slate",
};
