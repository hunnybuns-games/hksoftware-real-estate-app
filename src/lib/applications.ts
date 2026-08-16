import type { ApplicationStatus } from "@prisma/client";

/**
 * Pure logic behind the rental-applications feature — status display and the
 * transition rules, split out the same way insurance.ts and reconciliation.ts
 * keep their domain math framework-free and unit-testable.
 */

// Matches BadgeTone in src/components/ui.tsx (the subset this ever produces) —
// kept as this module's own type rather than importing a UI-layer type into
// framework-free domain logic, same separation as InsuranceStatusTone.
export type ApplicationStatusTone = "green" | "amber" | "blue" | "red" | "slate";

const STATUS_META: Record<ApplicationStatus, { label: string; tone: ApplicationStatusTone }> = {
  SUBMITTED: { label: "Submitted", tone: "amber" },
  UNDER_REVIEW: { label: "Under review", tone: "blue" },
  APPROVED: { label: "Approved", tone: "green" },
  DENIED: { label: "Denied", tone: "red" },
  WITHDRAWN: { label: "Withdrawn", tone: "slate" },
};

export function applicationStatusLabel(status: ApplicationStatus): string {
  return STATUS_META[status].label;
}

export function applicationStatusTone(status: ApplicationStatus): ApplicationStatusTone {
  return STATUS_META[status].tone;
}

/**
 * The transition graph for the staff-facing review form. Exists so a stale
 * tab — or a second staff member reviewing the same application at the same
 * time — can't skip a withdrawn application straight to approved, or "revive"
 * one that's already become a lease. `SUBMITTED -> APPROVED` is intentionally
 * allowed directly: a small landlord who already knows the applicant (a
 * current resident's roommate, a walk-in they've already vetted by phone)
 * shouldn't be forced through an "under review" step that adds nothing.
 */
const ALLOWED_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  SUBMITTED: ["UNDER_REVIEW", "APPROVED", "DENIED", "WITHDRAWN"],
  UNDER_REVIEW: ["APPROVED", "DENIED", "WITHDRAWN"],
  APPROVED: ["DENIED", "WITHDRAWN"], // reverse a decision, as long as it hasn't become a lease yet
  DENIED: ["UNDER_REVIEW"], // reopen if circumstances change
  WITHDRAWN: [],
};

/** Also true when `from === to` — saving review notes without changing status. */
export function canTransitionApplication(from: ApplicationStatus, to: ApplicationStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Everything the review form's status dropdown should offer: the current
 * status (so "just save my notes" is a no-op selection) plus whatever it can
 * legally move to next.
 */
export function nextStatusOptions(current: ApplicationStatus): ApplicationStatus[] {
  return [current, ...ALLOWED_TRANSITIONS[current]];
}

/** Whether an application's status is a final one — nothing else will happen to it here. */
export function isApplicationDecided(status: ApplicationStatus): boolean {
  return status === "APPROVED" || status === "DENIED" || status === "WITHDRAWN";
}

/**
 * How many times market rent the applicant's self-reported income covers.
 * Null when no income was reported — that's "unknown", not "fails the ratio",
 * and callers must not treat it as a failure.
 */
export function incomeToRentRatio(args: {
  monthlyIncomeCents: number | null;
  rentAmountCents: number;
}): number | null {
  if (args.monthlyIncomeCents == null || args.rentAmountCents <= 0) return null;
  return args.monthlyIncomeCents / args.rentAmountCents;
}

/** The common screening rule of thumb: income at least 3x the rent. */
export const DEFAULT_INCOME_RENT_RATIO = 3;

/**
 * Null means "can't say" (no income reported), never "no". Staff-facing UI
 * must render that third state rather than defaulting it to a pass or fail.
 */
export function meetsIncomeGuideline(args: {
  monthlyIncomeCents: number | null;
  rentAmountCents: number;
  ratio?: number;
}): boolean | null {
  const actual = incomeToRentRatio(args);
  if (actual === null) return null;
  return actual >= (args.ratio ?? DEFAULT_INCOME_RENT_RATIO);
}
