import { db } from "@/lib/db";
import { syncTransactions, type PlaidTransaction } from "@/lib/plaid";
import { decryptToken } from "@/lib/token-encryption";
import { suggestLeaseMatch, type MatchableLease } from "@/lib/lease-matching";
import { applyReconciliation } from "@/lib/reconciliation";

/**
 * Money leaving the account (a debit) is never a rent payment — see the
 * amount-sign note on PlaidTransaction in src/lib/plaid.ts. Zero is excluded
 * too, the same rule the CSV importer applies (src/lib/import-mapping.ts).
 */
export function isCandidateDeposit(t: PlaidTransaction): boolean {
  return t.amountCents > 0;
}

export function matchText(t: PlaidTransaction): string {
  return `${t.merchantName ?? ""} ${t.name}`;
}

export type ExistingPlaidPayment = { id: string; leaseId: string | null };

export type AddedDecision =
  | { action: "skip" }
  | { action: "create"; leaseId: string | null };

/**
 * Pure decision for one transaction from Plaid's `added` list — no DB call
 * here, just the logic a caller (syncBankConnection below) executes. Kept
 * separate specifically so it's unit-testable without a database, the same
 * split reconciliation.ts uses between computeReconciliation and
 * applyReconciliation.
 */
export function decideAddedTransaction(
  t: PlaidTransaction,
  alreadySynced: boolean,
  candidates: MatchableLease[],
): AddedDecision {
  if (!isCandidateDeposit(t)) return { action: "skip" };
  if (alreadySynced) return { action: "skip" }; // a replayed page, most likely
  const leaseId = suggestLeaseMatch(matchText(t), candidates)?.leaseId ?? null;
  return { action: "create", leaseId };
}

export type ModifiedDecision =
  | { action: "create"; leaseId: string | null } // never stored — treat like a fresh add
  | { action: "update"; leaseId: string | null }
  | { action: "delete"; leaseId: string | null } // was a deposit, corrected into a debit
  | { action: "skip" }; // never stored, and still not a deposit — nothing to do

/**
 * Plaid sends `modified` for a transaction it already told us about whose
 * details changed (amount correction, pending -> posted with the same id —
 * a genuinely *new* id for pending-to-posted goes through added/removed
 * instead). Deliberately never re-runs the matcher against an existing row:
 * re-matching here could flip a payment a human already corrected back to
 * whatever the text heuristic prefers. Reconciliation gets recomputed by the
 * caller regardless, since amountCents may have changed.
 */
export function decideModifiedTransaction(
  t: PlaidTransaction,
  existing: ExistingPlaidPayment | null,
  candidates: MatchableLease[],
): ModifiedDecision {
  if (!existing) {
    if (!isCandidateDeposit(t)) return { action: "skip" };
    const leaseId = suggestLeaseMatch(matchText(t), candidates)?.leaseId ?? null;
    return { action: "create", leaseId };
  }
  if (!isCandidateDeposit(t)) return { action: "delete", leaseId: existing.leaseId };
  return { action: "update", leaseId: existing.leaseId };
}

/**
 * Pulls new transactions for a BankConnection since its last-synced cursor
 * and applies the decisions above, turning each into a Payment row the same
 * way the CSV import confirm step does (see confirmImportAction in
 * actions/import.ts). Reconciliation is recomputed for every lease touched,
 * once, after all pages are processed.
 *
 * Called from the Plaid webhook route on SYNC_UPDATES_AVAILABLE; can also be
 * run by hand — see docs/MAINTAINER.md.
 *
 * Idempotent against being handed a stale cursor (e.g. a retry after a crash
 * mid-sync): decideAddedTransaction's alreadySynced check means replaying a
 * page that already landed is a no-op rather than a duplicate payment.
 */
export async function syncBankConnection(bankConnectionId: string): Promise<{
  added: number;
  modified: number;
  removed: number;
}> {
  const connection = await db.bankConnection.findUnique({ where: { id: bankConnectionId } });
  if (!connection) throw new Error(`BankConnection ${bankConnectionId} not found.`);

  // Don't sync a connection that needs re-auth or was revoked — Plaid would
  // just error on it, and a stale cursor is safer left untouched until the
  // owner reconnects than advanced against a call that never really synced.
  if (connection.status !== "ACTIVE") {
    return { added: 0, modified: 0, removed: 0 };
  }

  const accessToken = await decryptToken(connection.accessTokenEncrypted);
  const candidates = await matchableLeasesFor(connection.organizationId);

  let cursor = connection.cursor;
  let addedCount = 0;
  let modifiedCount = 0;
  let removedCount = 0;
  const affectedLeaseIds = new Set<string>();

  let hasMore = true;
  while (hasMore) {
    let page;
    try {
      page = await syncTransactions({ accessToken, cursor });
    } catch (err) {
      if (isItemLoginRequired(err)) {
        await db.bankConnection.update({
          where: { id: connection.id },
          data: { status: "LOGIN_REQUIRED" },
        });
        break;
      }
      throw err;
    }

    for (const t of page.added) {
      const existing = await findExistingPlaidPayment(connection.organizationId, t.transactionId);
      const decision = decideAddedTransaction(t, existing !== null, candidates);
      if (decision.action === "create") {
        await db.payment.create({ data: toPaymentData(connection.organizationId, t, decision.leaseId) });
        addedCount += 1;
        if (decision.leaseId) affectedLeaseIds.add(decision.leaseId);
      }
    }

    for (const t of page.modified) {
      const existing = await findExistingPlaidPayment(connection.organizationId, t.transactionId);
      const decision = decideModifiedTransaction(t, existing, candidates);
      if (decision.action === "create") {
        await db.payment.create({ data: toPaymentData(connection.organizationId, t, decision.leaseId) });
        modifiedCount += 1;
      } else if (decision.action === "update" && existing) {
        await db.payment.update({
          where: { id: existing.id },
          data: {
            amountCents: t.amountCents,
            status: t.pending ? "PROCESSING" : "SUCCEEDED",
            memo: t.name,
            payerNameRaw: t.merchantName,
            paidAt: new Date(t.date),
          },
        });
        modifiedCount += 1;
      } else if (decision.action === "delete" && existing) {
        await db.payment.delete({ where: { id: existing.id } });
        modifiedCount += 1;
      }
      if (decision.action !== "skip" && decision.leaseId) affectedLeaseIds.add(decision.leaseId);
    }

    for (const transactionId of page.removedTransactionIds) {
      const existing = await findExistingPlaidPayment(connection.organizationId, transactionId);
      if (existing) {
        await db.payment.delete({ where: { id: existing.id } });
        removedCount += 1;
        if (existing.leaseId) affectedLeaseIds.add(existing.leaseId);
      }
    }

    cursor = page.nextCursor;
    hasMore = page.hasMore;

    // Persist progress after each page, not just once at the end — a crash
    // partway through a large backlog should resume from here, not restart
    // and re-check every transaction from the beginning of the Item's history.
    await db.bankConnection.update({
      where: { id: connection.id },
      data: { cursor, lastSyncedAt: new Date() },
    });
  }

  for (const leaseId of affectedLeaseIds) {
    await applyReconciliation(leaseId);
  }

  return { added: addedCount, modified: modifiedCount, removed: removedCount };
}

function toPaymentData(organizationId: string, t: PlaidTransaction, leaseId: string | null) {
  return {
    organizationId,
    leaseId,
    amountCents: t.amountCents,
    status: t.pending ? ("PROCESSING" as const) : ("SUCCEEDED" as const),
    source: "IMPORT_PLAID" as const,
    reconciliationStatus: leaseId ? ("MATCHED" as const) : ("UNMATCHED" as const),
    paidAt: new Date(t.date),
    memo: t.name,
    payerNameRaw: t.merchantName,
    externalRef: t.transactionId,
  };
}

async function findExistingPlaidPayment(
  organizationId: string,
  transactionId: string,
): Promise<ExistingPlaidPayment | null> {
  return db.payment.findFirst({
    where: { organizationId, source: "IMPORT_PLAID", externalRef: transactionId },
    select: { id: true, leaseId: true },
  });
}

async function matchableLeasesFor(organizationId: string): Promise<MatchableLease[]> {
  const leases = await db.lease.findMany({
    where: { organizationId, status: { in: ["ACTIVE", "DRAFT"] } },
    select: {
      id: true,
      tenant: { select: { firstName: true, lastName: true } },
      unit: { select: { label: true, property: { select: { name: true } } } },
    },
  });
  return leases.map((l) => ({
    leaseId: l.id,
    tenantFirstName: l.tenant.firstName,
    tenantLastName: l.tenant.lastName,
    unitLabel: l.unit.label,
    propertyName: l.unit.property.name,
  }));
}

/** Plaid's error responses carry an error_code field; axios surfaces the body at err.response.data. */
function isItemLoginRequired(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("response" in err)) return false;
  const response = (err as { response?: { data?: unknown } }).response;
  const data = response?.data;
  return (
    typeof data === "object" &&
    data !== null &&
    "error_code" in data &&
    (data as { error_code?: string }).error_code === "ITEM_LOGIN_REQUIRED"
  );
}
