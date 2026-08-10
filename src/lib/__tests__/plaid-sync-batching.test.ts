import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaidSyncResult, PlaidTransaction } from "@/lib/plaid";

/**
 * Guards the query budget of syncBankConnection().
 *
 * The original implementation issued two database round-trips per transaction
 * and pulled an account's entire history in one request, which blew past both
 * D1's per-invocation query cap and its 100-bound-parameter-per-query limit —
 * the first sync of a real bank account could not have succeeded. These tests
 * exist so nobody quietly reintroduces a per-transaction query.
 *
 * Everything the module touches is mocked, so this runs in CI with no database
 * and no network: what's under test is how many calls are made and how big each
 * batch is, not the SQL itself (chunk sizes were verified against real
 * generated SQL separately — see the constants' comment in plaid-sync.ts).
 */

type Call = { op: string; size: number };
let calls: Call[] = [];
let pages: PlaidSyncResult[] = [];
let pageRequests: { cursor: string | null; count?: number }[] = [];

function record(op: string, size = 1) {
  calls.push({ op, size });
}

const fakeDb = {
  bankConnection: {
    findUnique: vi.fn(async () => {
      record("bankConnection.findUnique");
      return {
        id: "conn-1",
        organizationId: "org-1",
        accessTokenEncrypted: "encrypted",
        cursor: null,
        status: "ACTIVE",
      };
    }),
    update: vi.fn(async () => {
      record("bankConnection.update");
      return {};
    }),
  },
  lease: {
    findMany: vi.fn(async () => {
      record("lease.findMany");
      return [
        {
          id: "lease-1",
          tenant: { firstName: "Maria", lastName: "Fernandez" },
          unit: { label: "2B", property: { name: "Alder House" } },
        },
      ];
    }),
  },
  payment: {
    findMany: vi.fn(async ({ where }: { where: { externalRef: { in: string[] } } }) => {
      record("payment.findMany", where.externalRef.in.length);
      return []; // nothing already synced
    }),
    createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
      record("payment.createMany", data.length);
      return { count: data.length };
    }),
    update: vi.fn(async () => {
      record("payment.update");
      return {};
    }),
    deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
      record("payment.deleteMany", where.id.in.length);
      return { count: where.id.in.length };
    }),
  },
};

vi.mock("@/lib/db", () => ({ db: fakeDb }));
vi.mock("@/lib/token-encryption", () => ({ decryptToken: async () => "access-token" }));
vi.mock("@/lib/reconciliation", () => ({
  applyReconciliation: async () => {
    record("applyReconciliation");
  },
}));
vi.mock("@/lib/plaid", () => ({
  syncTransactions: async (args: { cursor: string | null; count?: number }) => {
    pageRequests.push({ cursor: args.cursor, count: args.count });
    const next = pages.shift();
    if (!next) throw new Error("test asked for more pages than were staged");
    return next;
  },
}));

const { syncBankConnection } = await import("@/lib/plaid-sync");

function deposit(i: number): PlaidTransaction {
  return {
    transactionId: `tx-${i}`,
    accountId: "acct-1",
    amountCents: 180000,
    date: "2026-08-01",
    // Deliberately unmatchable text, so every row takes the same path and the
    // counts under test aren't perturbed by lease matching.
    name: `MOBILE DEPOSIT ${i}`,
    merchantName: null,
    pending: false,
  };
}

function page(added: PlaidTransaction[], hasMore: boolean, cursor: string): PlaidSyncResult {
  return { added, modified: [], removedTransactionIds: [], nextCursor: cursor, hasMore };
}

beforeEach(() => {
  calls = [];
  pages = [];
  pageRequests = [];
  vi.clearAllMocks();
});

function countOf(op: string) {
  return calls.filter((c) => c.op === op).length;
}
function sizesOf(op: string) {
  return calls.filter((c) => c.op === op).map((c) => c.size);
}

describe("syncBankConnection query budget", () => {
  it("makes no per-transaction queries — one page of 100 costs far fewer than 100 calls", async () => {
    const added = Array.from({ length: 100 }, (_, i) => deposit(i));
    pages = [page(added, false, "cursor-1")];

    const result = await syncBankConnection("conn-1");

    expect(result.added).toBe(100);

    // The regression this file exists to prevent: the old code did 2 queries per
    // transaction, so 100 transactions meant ~200 round-trips.
    expect(calls.length).toBeLessThan(30);
    expect(countOf("payment.findMany")).toBeLessThan(5);
  });

  it("chunks inserts so a statement can't exceed D1's bound-parameter limit", async () => {
    const added = Array.from({ length: 100 }, (_, i) => deposit(i));
    pages = [page(added, false, "cursor-1")];

    await syncBankConnection("conn-1");

    const inserts = sizesOf("payment.createMany");
    expect(inserts.length).toBe(Math.ceil(100 / 6));
    // A Payment row writes ~13 columns; 6 rows is ~78 parameters, under 100.
    // Anything larger fails at runtime with "too many SQL variables".
    for (const size of inserts) expect(size).toBeLessThanOrEqual(6);
    expect(inserts.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("chunks the existence lookup the same way", async () => {
    const added = Array.from({ length: 200 }, (_, i) => deposit(i));
    pages = [page(added, false, "cursor-1")];

    await syncBankConnection("conn-1");

    const lookups = sizesOf("payment.findMany");
    expect(lookups.length).toBe(Math.ceil(200 / 80));
    for (const size of lookups) expect(size).toBeLessThanOrEqual(80);
  });

  it("asks Plaid for a bounded page size instead of taking the default", async () => {
    pages = [page([deposit(0)], false, "cursor-1")];
    await syncBankConnection("conn-1");
    expect(pageRequests[0].count).toBe(100);
  });

  it("stops at the page cap and reports that there's more to collect", async () => {
    // Six pages available, cap is five.
    pages = Array.from({ length: 6 }, (_, p) =>
      page([deposit(p * 10)], p < 5, `cursor-${p + 1}`),
    );

    const result = await syncBankConnection("conn-1");

    expect(result.pagesProcessed).toBe(5);
    expect(result.hasMore).toBe(true);
    expect(pages.length).toBe(1); // the sixth page was left uncollected
  });

  it("persists the cursor after every page, so stopping early loses no progress", async () => {
    pages = [
      page([deposit(1)], true, "cursor-A"),
      page([deposit(2)], false, "cursor-B"),
    ];

    await syncBankConnection("conn-1");

    // One cursor write per page, and the second request resumed from the first
    // page's cursor rather than starting over.
    expect(countOf("bankConnection.update")).toBe(2);
    expect(pageRequests[0].cursor).toBeNull();
    expect(pageRequests[1].cursor).toBe("cursor-A");
  });

  it("reports hasMore false when Plaid is fully drained", async () => {
    pages = [page([deposit(1)], false, "cursor-final")];
    const result = await syncBankConnection("conn-1");
    expect(result.hasMore).toBe(false);
    expect(result.pagesProcessed).toBe(1);
  });

  it("does no work at all for a connection needing re-authentication", async () => {
    fakeDb.bankConnection.findUnique.mockImplementationOnce(async () => {
      record("bankConnection.findUnique");
      return {
        id: "conn-1",
        organizationId: "org-1",
        accessTokenEncrypted: "encrypted",
        cursor: null,
        status: "LOGIN_REQUIRED",
      };
    });

    const result = await syncBankConnection("conn-1");

    expect(result).toEqual({
      added: 0,
      modified: 0,
      removed: 0,
      hasMore: false,
      pagesProcessed: 0,
    });
    expect(countOf("payment.createMany")).toBe(0);
    expect(pageRequests.length).toBe(0);
  });

  it("skips debits without spending an insert on them", async () => {
    const debits = Array.from({ length: 12 }, (_, i) => ({
      ...deposit(i),
      amountCents: -5000,
    }));
    pages = [page(debits, false, "cursor-1")];

    const result = await syncBankConnection("conn-1");

    expect(result.added).toBe(0);
    expect(countOf("payment.createMany")).toBe(0);
  });
});
