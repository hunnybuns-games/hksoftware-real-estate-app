import { daysBetweenUtc } from "@/lib/dates";

/**
 * Renter's insurance is tracked, not enforced — see the schema comment on
 * Lease.insuranceRequired. This is the pure status computation behind the
 * badge on the lease page, split out the same way ledger.ts separates balance
 * math from the page that renders it: no clock read here, `asOf` always comes
 * from the caller, so this is deterministic and unit-testable.
 */

// Matches BadgeTone in src/components/ui.tsx (the subset this ever produces) —
// kept as this module's own type rather than importing a UI-layer type into
// framework-free domain logic, the same separation ledger.ts and
// reconciliation.ts keep from their pages.
export type InsuranceStatusTone = "green" | "amber" | "red" | "slate";

export type InsuranceStatus = {
  tone: InsuranceStatusTone;
  label: string;
};

/** Days out from expiry that counts as "renew this soon" rather than "fine". */
const EXPIRING_SOON_DAYS = 30;

export function insuranceStatus(args: {
  required: boolean;
  expiresAt: Date | null;
  asOf: Date;
}): InsuranceStatus {
  if (!args.required && !args.expiresAt) {
    return { tone: "slate", label: "Not required" };
  }
  if (!args.expiresAt) {
    // Required (or was tracked before) but no policy on file at all.
    return { tone: "red", label: "Missing" };
  }

  const daysUntilExpiry = daysBetweenUtc(args.asOf, args.expiresAt);
  if (daysUntilExpiry < 0) return { tone: "red", label: "Expired" };
  if (daysUntilExpiry <= EXPIRING_SOON_DAYS) return { tone: "amber", label: "Expiring soon" };
  return { tone: "green", label: "Current" };
}
