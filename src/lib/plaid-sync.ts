import { db } from "@/lib/db";
import { chunked } from "@/lib/chunk";
import { syncTransactions, type PlaidTransaction } from "@/lib/plaid";
import { decryptToken } from "@/lib/token-encryption";
import { suggestLeaseMatch, type MatchableLease } from "@/lib/lease-matching";
import { applyReconciliation } from "@/lib/reconciliation";

/**
 * Sized against D1's ceiling of 100 bound parameters per query (see
 * src/lib/chunk.ts). None of these numbers are arbitrary — a larger value
 * doesn't get slower, it fails outright with "too many SQL variables".
 *
 *  - INSERT_CHUNK: a Payment row writes ~13 columns, so 6 rows is ~78
 *    parameters. Prisma emits createMany as one multi-row INSERT, so the row
 *    count is what has to stay bounded.
 *  - ID_CHUNK: an `id IN (…)` lookup spends one parameter per id plus a few on
 *    the surrounding filters.
 *
 * PAGE_SIZE × MAX_PAGES_PER_RUN together bound how much work one invocation
 * can do, because a Worker request also has a per-invocation query cap (1,000
 * on the Workers Paid plan, 50 on Free) and a wall-clock limit. Hitting the
 * page cap is not a failure: the cursor is persisted after every page, so the
 * next run resumes exactly where this one stopped, and `hasMore` in the return
 * value tells the caller there's more to collect.
 *
 * The pathological case this replaced: two queries per transaction, with the
 * first sync of a connected account pulling its entire history in one request.
 * A single 500-transaction page was already ~1,000 queries.
 */
const INSERT_CHUNK = 6;
const ID_CHUNK = 80;
const PAGE_SIZE = 100;
const MAX_PAGES_PER_RUN = 5;

export type SyncOutcome = {
  added: number;
  modified: number;
  removed: number;
  /** True when Plaid still has pages we didn't collect — call again to continue. */
  hasMore: boolean;
  pagesProcessed: number;
};

type PaymentCreateData = ReturnType<typeof toPaymentData>;

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
export async function syncBankConnection(bankConnectionId: string): Promise<SyncOutcome> {
  const connection = await db.bankConnection.findUnique({ where: { id: bankConnectionId } });
  if (!connection) throw new Error(`BankConnection ${bankConnectionId} not found.`);

  // Don't sync a connection that needs re-auth or was revoked — Plaid would
  // just error on it, and a stale cursor is safer left untouched until the
  // owner reconnects than advanced against a call that never really synced.
  if (connection.status !== "ACTIVE") {
    return { added: 0, modified: 0, removed: 0, hasMore: false, pagesProcessed: 0 };
  }

  const accessToken = await decryptToken(connection.accessTokenEncrypted);
  const candidates = await matchableLeasesFor(connection.organizationId);
  const organizationId = connection.organizationId;

  let cursor = connection.cursor;
  let addedCount = 0;
  let modifiedCount = 0;
  let removedCount = 0;
  let pagesProcessed = 0;
  let hasMore = true;
  const affectedLeaseIds = new Set<string>();

  while (hasMore && pagesProcessed < MAX_PAGES_PER_RUN) {
    let page;
    try {
      page = await syncTransactions({ accessToken, cursor, count: PAGE_SIZE });
    } catch (err) {
      if (isItemLoginRequired(err)) {
        await db.bankConnection.update({
          where: { id: connection.id },
          data: { status: "LOGIN_REQUIRED" },
        });
        hasMore = false;
        break;
      }
      throw err;
    }

    // One batched lookup for the whole page, covering all three lists at once,
    // instead of a round-trip per transaction. This is the change that makes
    // the sync viable at all — see the note on query budget above.
    const referencedIds = [
      ...page.added.map((t) => t.transactionId),
      ...page.modified.map((t) => t.transactionId),
      ...page.removedTransactionIds,
    ];
    const existingByRef = await findExistingPlaidPayments(organizationId, referencedIds);

    const toCreate: PaymentCreateData[] = [];
    const toUpdate: { id: string; transaction: PlaidTransaction }[] = [];
    const toDeleteIds: string[] = [];

    for (const t of page.added) {
      const decision = decideAddedTransaction(t, existingByRef.has(t.transactionId), candidates);
      if (decision.action === "create") {
        toCreate.push(toPaymentData(organizationId, t, decision.leaseId));
        addedCount += 1;
        if (decision.leaseId) affectedLeaseIds.add(decision.leaseId);
      }
    }

    for (const t of page.modified) {
      const existing = existingByRef.get(t.transactionId) ?? null;
      const decision = decideModifiedTransaction(t, existing, candidates);

      if (decision.action === "create") {
        toCreate.push(toPaymentData(organizationId, t, decision.leaseId));
        modifiedCount += 1;
      } else if (decision.action === "update" && existing) {
        toUpdate.push({ id: existing.id, transaction: t });
        modifiedCount += 1;
      } else if (decision.action === "delete" && existing) {
        toDeleteIds.push(existing.id);
        modifiedCount += 1;
      }
      if (decision.action !== "skip" && decision.leaseId) affectedLeaseIds.add(decision.leaseId);
    }

    for (const transactionId of page.removedTransactionIds) {
      const existing = existingByRef.get(transactionId);
      if (!existing) continue;
      toDeleteIds.push(existing.id);
      removedCount += 1;
      if (existing.leaseId) affectedLeaseIds.add(existing.leaseId);
    }

    for (const chunk of chunked(toCreate, INSERT_CHUNK)) {
      await db.payment.createMany({ data: chunk });
    }

    // Updates stay one statement each — there's no batched form for "set
    // different values on different rows". Fine in practice: `modified` only
    // ever contains transactions Plaid already told us about and has since
    // corrected, which is a trickle, not a backlog.
    for (const { id, transaction } of toUpdate) {
      await db.payment.update({
        where: { id },
        data: {
          amountCents: transaction.amountCents,
          status: transaction.pending ? "PROCESSING" : "SUCCEEDED",
          memo: transaction.name,
          payerNameRaw: transaction.merchantName,
          paidAt: new Date(transaction.date),
        },
      });
    }

    for (const chunk of chunked(toDeleteIds, ID_CHUNK)) {
      await db.payment.deleteMany({ where: { id: { in: chunk } } });
    }

    cursor = page.nextCursor;
    hasMore = page.hasMore;
    pagesProcessed += 1;

    // Persist progress after each page, not just once at the end — a crash
    // partway through a large backlog should resume from here, not restart
    // and re-check every transaction from the beginning of the Item's history.
    // This is also what makes stopping at MAX_PAGES_PER_RUN safe.
    await db.bankConnection.update({
      where: { id: connection.id },
      data: { cursor, lastSyncedAt: new Date() },
    });
  }

  // Bounded by how many distinct leases this batch touched, not by transaction
  // count — and in practice small, since most bank descriptors don't identify a
  // tenant well enough to match at all.
  for (const leaseId of affectedLeaseIds) {
    await applyReconciliation(leaseId);
  }

  return { added: addedCount, modified: modifiedCount, removed: removedCount, hasMore, pagesProcessed };
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

/**
 * Which of these Plaid transaction ids do we already have Payment rows for,
 * keyed by transaction id. One query per ID_CHUNK ids rather than one per
 * transaction — the whole point of the rewrite.
 */
async function findExistingPlaidPayments(
  organizationId: string,
  transactionIds: string[],
): Promise<Map<string, ExistingPlaidPayment>> {
  const byRef = new Map<string, ExistingPlaidPayment>();
  if (transactionIds.length === 0) return byRef;

  // Plaid can legitimately list the same id in more than one bucket across a
  // page boundary; de-duplicate so we don't waste parameters on repeats.
  const unique = [...new Set(transactionIds)];

  for (const chunk of chunked(unique, ID_CHUNK)) {
    const rows = await db.payment.findMany({
      where: { organizationId, source: "IMPORT_PLAID", externalRef: { in: chunk } },
      select: { id: true, leaseId: true, externalRef: true },
    });
    for (const row of rows) {
      if (row.externalRef) byRef.set(row.externalRef, { id: row.id, leaseId: row.leaseId });
    }
  }

  return byRef;
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
