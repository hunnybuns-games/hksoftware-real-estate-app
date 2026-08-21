import type { ScreeningStatus } from "@prisma/client";

/**
 * Pure logic behind tenant screening — status display, the FCRA disclosure
 * copy, and the small amount of transition logic the flow needs — split out
 * framework-free and unit-testable the same way applications.ts and
 * listing.ts keep their domain logic. See docs/tenant-screening.md for what
 * this feature actually is (a consent + manual-recording framework, not a
 * live credit-bureau integration) and what it deliberately is not.
 */

// Matches BadgeTone in src/components/ui.tsx (the subset this ever produces).
export type ScreeningStatusTone = "green" | "amber" | "blue" | "red" | "slate";

const STATUS_META: Record<ScreeningStatus, { label: string; tone: ScreeningStatusTone }> = {
  AWAITING_CONSENT: { label: "Awaiting consent", tone: "amber" },
  IN_PROGRESS: { label: "In progress", tone: "blue" },
  COMPLETED: { label: "Completed", tone: "green" },
  DECLINED: { label: "Declined", tone: "red" },
  CANCELED: { label: "Canceled", tone: "slate" },
};

export function screeningStatusLabel(status: ScreeningStatus): string {
  return STATUS_META[status].label;
}

export function screeningStatusTone(status: ScreeningStatus): ScreeningStatusTone {
  return STATUS_META[status].tone;
}

/** Whether the applicant still needs to respond to a consent request. */
export function isAwaitingConsent(status: ScreeningStatus): boolean {
  return status === "AWAITING_CONSENT";
}

/** Whether staff can record results right now (consent given, nothing recorded yet). */
export function canRecordResults(status: ScreeningStatus): boolean {
  return status === "IN_PROGRESS";
}

/**
 * Whether a new screening request can be started for this application.
 * `null` (no request exists yet) is always startable; an existing request
 * blocks a new one only while it's still live — a declined, canceled, or
 * completed one can be superseded by a fresh request (circumstances change:
 * an applicant who declined once might consent on a second unit, staff might
 * need a repeat check for a long-pending application).
 */
export function canStartNewScreening(status: ScreeningStatus | null): boolean {
  if (status === null) return true;
  return status === "DECLINED" || status === "CANCELED" || status === "COMPLETED";
}

/** "Credit and background", "Credit, background, and eviction", etc. — never empty in practice, since the request form requires at least one. */
export function screeningTypesLabel(args: {
  wantCredit: boolean;
  wantBackground: boolean;
  wantEviction: boolean;
}): string {
  const parts = [
    args.wantCredit && "credit",
    args.wantBackground && "background",
    args.wantEviction && "eviction",
  ].filter((v): v is string => Boolean(v));
  if (parts.length === 0) return "No report types selected";
  if (parts.length === 1) return capitalize(parts[0]);
  if (parts.length === 2) return `${capitalize(parts[0])} and ${parts[1]}`;
  return `${capitalize(parts[0])}, ${parts[1]}, and ${parts[2]}`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The standalone disclosure the Fair Credit Reporting Act requires before a
 * landlord (or anyone acting for one) can procure a consumer report —
 * separate from any lease or application paperwork, in writing, and clear.
 * This is a template, not legal advice: it names the general shape (what's
 * being pulled, why, and the applicant's own rights under the Act) but has
 * not been reviewed by a lawyer, and `[ORGANIZATION NAME]` is a stand-in.
 * See docs/tenant-screening.md before relying on this for a real applicant.
 */
export const FCRA_DISCLOSURE_PARAGRAPHS: readonly string[] = [
  "[ORGANIZATION NAME] would like your permission to obtain a consumer report about you — which may include a credit report, a criminal background check, and an eviction history search — in connection with your rental application. This report will be used solely to evaluate your application.",
  "By consenting below, you authorize [ORGANIZATION NAME] and its screening provider to request this information from consumer reporting agencies. You have the right to request the name and address of any agency that furnishes a report about you, to know its contents, and to dispute any inaccurate or incomplete information directly with that agency. If your application is denied in whole or in part because of information in a consumer report, you will be notified separately and given the reporting agency's contact information, as required by the Fair Credit Reporting Act.",
  "Consenting is voluntary. You may decline — your application will still be reviewed, though [ORGANIZATION NAME] may not be able to complete its usual screening process without this information.",
];

/** Which types of report this specific request is asking about, folded into the disclosure. */
export function disclosureScopeLine(args: {
  wantCredit: boolean;
  wantBackground: boolean;
  wantEviction: boolean;
}): string {
  const count = [args.wantCredit, args.wantBackground, args.wantEviction].filter(Boolean).length;
  const noun = count === 1 ? "report" : "reports";
  return `For this application, that means: ${screeningTypesLabel(args).toLowerCase()} ${noun}.`;
}
