import type { PaymentReconciliationStatus, PaymentSource } from "@prisma/client";

/**
 * Human labels for PaymentSource, shared by every screen that lists payments
 * (lease ledger, dashboard, rent page, owner view, reports/exports) so the
 * wording never drifts between them.
 */
export const PAYMENT_SOURCE_LABELS: Record<PaymentSource, string> = {
  MANUAL_CASH: "Cash / check",
  IMPORT_BANK: "Bank transfer",
  IMPORT_VENMO: "Venmo",
  IMPORT_CASHAPP: "Cash App",
  IMPORT_HAP: "Housing authority (HAP)",
  STRIPE_NATIVE: "Online (Stripe)",
  IMPORT_PLAID: "Bank feed",
};

/** Short form for tight table cells / CSV columns. */
export const PAYMENT_SOURCE_SHORT_LABELS: Record<PaymentSource, string> = {
  MANUAL_CASH: "Cash",
  IMPORT_BANK: "Bank",
  IMPORT_VENMO: "Venmo",
  IMPORT_CASHAPP: "Cash App",
  IMPORT_HAP: "HAP",
  STRIPE_NATIVE: "Stripe",
  IMPORT_PLAID: "Bank feed",
};

export function paymentSourceLabel(source: PaymentSource): string {
  return PAYMENT_SOURCE_LABELS[source];
}

/** True for sources that represent a subsidy/housing-authority payer. */
export function isSubsidySource(source: PaymentSource): boolean {
  return source === "IMPORT_HAP";
}

export const RECONCILIATION_STATUS_LABELS: Record<PaymentReconciliationStatus, string> = {
  MATCHED: "Matched",
  SHORT: "Short",
  LATE: "Late",
  UNMATCHED: "Unmatched",
};
