/**
 * A second, separate demo dataset: one landlord, one 10-unit property, ten
 * tenants — two still prospects, eight on active leases, each on a
 * different rails/feature so the account demonstrates every payment,
 * maintenance, leasing, and screening path across a small, easy-to-remember
 * cast rather than the 34-unit main demo's larger and messier portfolio.
 *
 * Independent of `prisma/seed.ts` — different org name, different emails —
 * so running this never touches the main demo data, and running the main
 * seed never touches this. Not wired into the `db:seed` alias on purpose;
 * run it explicitly with `npm run db:seed:landlord10`.
 *
 * Where a real Stripe test-mode secret key is configured (STRIPE_SECRET_KEY
 * in .env), this also creates a real Connect Express account for the org
 * against Stripe's live test API — proving the integration end-to-end, not
 * just simulating it. Non-fatal if it fails or no key is set.
 *
 * Same idea for Plaid: where PLAID_CLIENT_ID/PLAID_SECRET point at a real
 * Sandbox environment, this also opens a real Plaid Item for the org's bank
 * feed and syncs several months of Caleb's rent through it — real Sandbox
 * transactions pulled in by the app's actual sync code, not Payment rows
 * written by hand. Also non-fatal; Caleb's rent is recorded manually instead
 * if Plaid isn't configured or the Sandbox call fails.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";
import { Products } from "plaid";
import bcrypt from "bcryptjs";

function localSqliteUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set.");
  assertLocalTarget(raw);
  const relative = raw.replace(/^file:/, "");
  return path.isAbsolute(relative) ? raw : `file:${path.join(process.cwd(), "prisma", relative)}`;
}

function assertLocalTarget(url: string): void {
  if (!url.startsWith("file:")) {
    throw new Error(
      `Refusing to seed: DATABASE_URL is not a local sqlite file (got "${url.split(":")[0]}:…").\n` +
        "This script wipes and rebuilds its own demo organization and must only run locally.",
    );
  }
}

const adapter = new PrismaBetterSQLite3({ url: localSqliteUrl() });
const db = new PrismaClient({ adapter });

const PASSWORD = "demo-password-123";
const ORG_NAME = "Sunrise Ridge Rentals";

/**
 * This script deletes and recreates the whole org on every run (see below),
 * so nothing in the database can remember a Stripe Connect account across
 * reseeds. Without this file, every reseed created a brand-new, unverified
 * Express account — throwing away Connect's hosted onboarding (which is a
 * real KYC flow, complete with a bot-detection challenge that has to be
 * solved by an actual human) every single time. Gitignored; safe to delete
 * if you want a genuinely fresh account.
 */
const SEED_STATE_FILE = path.join(process.cwd(), "prisma", ".landlord10-seed-state.json");
type SeedState = { stripeAccountId?: string };
function readSeedState(): SeedState {
  try {
    return JSON.parse(fs.readFileSync(SEED_STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}
function writeSeedState(state: SeedState): void {
  fs.writeFileSync(SEED_STATE_FILE, JSON.stringify(state, null, 2));
}

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}
function monthsAgo(n: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1));
}
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  const existing = await db.organization.findFirst({ where: { name: ORG_NAME } });
  if (existing) {
    const [staffUsers, tenantPortalUsers] = await Promise.all([
      db.user.findMany({ where: { organizationId: existing.id }, select: { id: true } }),
      db.user.findMany({ where: { tenant: { organizationId: existing.id } }, select: { id: true } }),
    ]);
    await db.organization.delete({ where: { id: existing.id } });
    await db.user.deleteMany({
      where: { id: { in: [...staffUsers, ...tenantPortalUsers].map((u) => u.id) } },
    });
    console.log("• removed previous landlord10 demo data");
  }

  const org = await db.organization.create({
    data: { name: ORG_NAME, graceDays: 5, lateFeeCents: 6000 },
  });

  const admin = await db.user.create({
    data: {
      email: "landlord10@example.com",
      name: "Jordan Reyes",
      passwordHash,
      role: "ADMIN",
      organizationId: org.id,
    },
  });

  // --- Live Stripe Connect account, if a test-mode key is configured -------
  // Best-effort: proves the real integration works against this org, but a
  // missing/invalid key (or a network hiccup) must never abort the seed.
  //
  // Reuses whatever account SEED_STATE_FILE remembers from a prior run rather
  // than creating a fresh one every time — see the comment on that file.
  // Reusing the account id doesn't skip onboarding on its own; it just means
  // onboarding, once actually completed (Settings -> Rent collection ->
  // Finish Stripe setup), sticks across reseeds instead of resetting.
  let stripeAccountId: string | null = null;
  let stripeChargesEnabled = false;
  let stripePayoutsEnabled = false;
  if (process.env.STRIPE_SECRET_KEY) {
    try {
      const { createConnectOnboardingLink, getAccountStatus } = await import("../src/lib/stripe");
      const priorState = readSeedState();
      const result = await createConnectOnboardingLink({
        organizationId: org.id,
        organizationName: org.name,
        existingAccountId: priorState.stripeAccountId ?? null,
        email: admin.email,
        returnUrl: "http://localhost:3000/app/settings/payments",
        refreshUrl: "http://localhost:3000/app/settings/payments",
      });
      stripeAccountId = result.accountId;
      writeSeedState({ ...priorState, stripeAccountId });

      const status = await getAccountStatus(stripeAccountId).catch(() => null);
      stripeChargesEnabled = status?.chargesEnabled ?? false;
      stripePayoutsEnabled = status?.payoutsEnabled ?? false;
      const verb = priorState.stripeAccountId === stripeAccountId ? "reused" : "created";
      console.log(
        `• ${verb} live Stripe test-mode Connect account ${stripeAccountId}` +
          (stripeChargesEnabled
            ? " (already verified, accepting payments)"
            : " (needs onboarding — Settings -> Rent collection -> Finish Stripe setup)"),
      );
    } catch (err) {
      console.warn(
        `• skipped Stripe Connect account creation (${err instanceof Error ? err.message : err})`,
      );
    }
  }

  // Mirrors what refreshStripeStatusAction would set on first load — written
  // directly here so the Settings page reflects reality immediately, without
  // requiring a manual "Refresh status" click right after seeding.
  await db.organization.update({
    where: { id: org.id },
    data: { stripeAccountId, stripeChargesEnabled, stripePayoutsEnabled },
  });

  const property = await db.property.create({
    data: {
      organizationId: org.id,
      name: "Sunrise Ridge Apartments",
      addressLine1: "540 Sunrise Ridge Drive",
      city: "Boise",
      state: "ID",
      postalCode: "83702",
      notes: "10-unit walkup. Shared laundry in the basement.",
      units: {
        create: Array.from({ length: 10 }, (_, i) => {
          const n = i + 1;
          const bedrooms = n % 4 === 0 ? 1 : n % 3 === 0 ? 3 : 2;
          return {
            label: `1${String(n).padStart(2, "0")}`,
            bedrooms,
            bathrooms: bedrooms >= 3 ? 2 : 1,
            sqft: 640 + bedrooms * 220,
            marketRentCents: 1_450_00 + bedrooms * 175_00,
            status: "VACANT" as const,
          };
        }),
      },
    },
    include: { units: { orderBy: { label: "asc" } } },
  });
  const unit = (label: string) => property.units.find((u) => u.label === label)!;

  // --- Tenants 1-2: prospects, each against a live Listing ------------------
  const { SYNDICATION_PLATFORMS } = await import("../src/lib/listing");

  async function makeListing(unitId: string, askingRentCents: number) {
    return db.listing.create({
      data: {
        organizationId: org.id,
        unitId,
        title: "Bright 2BR near the greenbelt",
        description:
          "Recently refreshed unit close to the river greenbelt trail. In-unit laundry hookups, off-street parking, pet friendly.",
        amenities: "In-unit laundry hookups, Pet friendly, Off-street parking",
        askingRentCents,
        availableDate: daysAgo(-14),
        status: "ACTIVE",
        createdById: admin.id,
        syndications: { create: SYNDICATION_PLATFORMS.map((platform) => ({ platform })) },
      },
    });
  }

  await makeListing(unit("109").id, unit("109").marketRentCents);
  await makeListing(unit("110").id, unit("110").marketRentCents);

  await db.application.create({
    data: {
      organizationId: org.id,
      unitId: unit("109").id,
      firstName: "Ava",
      lastName: "Thompson",
      email: "ava.thompson@example.com",
      phone: "208-555-1001",
      desiredMoveInDate: daysAgo(-21),
      occupants: 1,
      monthlyIncomeCents: 4_800_00,
      hasPets: false,
      message: "Relocating for work, would love to move in next month.",
      status: "SUBMITTED",
    },
  });

  const marcus = await db.application.create({
    data: {
      organizationId: org.id,
      unitId: unit("110").id,
      firstName: "Marcus",
      lastName: "Webb",
      email: "marcus.webb@example.com",
      phone: "208-555-1002",
      desiredMoveInDate: daysAgo(-7),
      occupants: 2,
      monthlyIncomeCents: 5_600_00,
      hasPets: true,
      petDetails: "One small dog, 25lbs, house-trained.",
      message: "Have a dog — happy to pay a pet deposit.",
      status: "UNDER_REVIEW",
      reviewedById: admin.id,
      reviewedAt: daysAgo(2),
      reviewNotes: "Income looks solid. Screening requested, waiting on results.",
    },
  });

  await db.screeningRequest.create({
    data: {
      organizationId: org.id,
      applicationId: marcus.id,
      wantCredit: true,
      wantBackground: true,
      wantEviction: true,
      status: "COMPLETED",
      consentToken: randomBytes(32).toString("base64url"),
      consentGivenAt: daysAgo(2),
      consentIpAddress: "203.0.113.42",
      consentUserAgent: "Mozilla/5.0 (seed data)",
      provider: "manual",
      resultSummary:
        "Credit: 712 (good). Background: clear, no records found. Eviction history: none on file. Recommend approval.",
      completedAt: daysAgo(1),
      completedById: admin.id,
      requestedById: admin.id,
      requestedAt: daysAgo(2),
    },
  });

  // --- Tenants 3-10: leased, one distinct scenario each ----------------------
  type Scenario = "brand_new" | "current" | "late" | "hap_split" | "maintenance_open" | "maintenance_done";

  // Where a real Plaid Sandbox connection can be established (see the bank
  // feed block below), Caleb's rent history is routed through it instead of
  // being written directly as Payment rows — the same "prove it end-to-end"
  // choice the Stripe Connect account above makes. Everyone else keeps a
  // fixed rail so the other seven scenarios (and the e2e tour's per-tenant
  // assertions) never depend on whether Plaid happens to be configured.
  const cast: {
    unit: string;
    firstName: string;
    lastName: string;
    scenario: Scenario;
    startedMonthsAgo: number;
    portal: boolean;
    paymentRail?: "manual" | "plaid";
  }[] = [
    { unit: "101", firstName: "Noah", lastName: "Kim", scenario: "brand_new", startedMonthsAgo: 0, portal: true },
    { unit: "102", firstName: "Isabella", lastName: "Cruz", scenario: "current", startedMonthsAgo: 6, portal: true },
    { unit: "103", firstName: "Ethan", lastName: "Brooks", scenario: "current", startedMonthsAgo: 5, portal: true },
    { unit: "104", firstName: "Sophia", lastName: "Reyes", scenario: "current", startedMonthsAgo: 7, portal: true },
    { unit: "105", firstName: "Liam", lastName: "Foster", scenario: "late", startedMonthsAgo: 8, portal: true },
    { unit: "106", firstName: "Zoe", lastName: "Whitaker", scenario: "hap_split", startedMonthsAgo: 9, portal: true },
    {
      unit: "107",
      firstName: "Caleb",
      lastName: "Nguyen",
      scenario: "maintenance_open",
      startedMonthsAgo: 4,
      portal: true,
      paymentRail: "plaid",
    },
    { unit: "108", firstName: "Harper", lastName: "Diaz", scenario: "maintenance_done", startedMonthsAgo: 10, portal: true },
  ];

  const { plaidEnabled, plaidSandboxMode } = await import("../src/lib/plaid");
  const useLivePlaid = plaidEnabled() && plaidSandboxMode();

  const leases: {
    id: string;
    tenantId: string;
    tenantFirstName: string;
    tenantLastName: string;
    unitLabel: string;
    scenario: Scenario;
    rentCents: number;
    dueDay: number;
    startedMonthsAgo: number;
    paymentRail: "manual" | "plaid";
  }[] = [];

  for (const [i, spec] of cast.entries()) {
    const u = unit(spec.unit);
    const tenant = await db.tenant.create({
      data: {
        organizationId: org.id,
        firstName: spec.firstName,
        lastName: spec.lastName,
        email: `${spec.firstName.toLowerCase()}.${spec.lastName.toLowerCase()}@example.com`,
        phone: `208-555-11${String(10 + i).padStart(2, "0")}`,
      },
    });

    const rentCents = u.marketRentCents;
    const dueDay = 1;
    const subsidyCents = spec.scenario === "hap_split" ? Math.round(rentCents * 0.4) : null;

    const lease = await db.lease.create({
      data: {
        organizationId: org.id,
        unitId: u.id,
        tenantId: tenant.id,
        status: "ACTIVE",
        startDate: spec.startedMonthsAgo === 0 ? daysAgo(3) : monthsAgo(spec.startedMonthsAgo),
        endDate: utc(
          new Date().getUTCFullYear() + 1,
          spec.startedMonthsAgo === 0 ? new Date().getUTCMonth() + 1 : monthsAgo(spec.startedMonthsAgo).getUTCMonth() + 1,
          1,
        ),
        rentAmountCents: rentCents,
        depositCents: rentCents,
        rentDueDay: dueDay,
        subsidyOwedCents: subsidyCents,
        subsidyPayerName: subsidyCents !== null ? "Ada County Housing Authority" : null,
      },
    });
    await db.unit.update({ where: { id: u.id }, data: { status: "OCCUPIED" } });

    if (spec.portal) {
      const portalUser = await db.user.create({
        data: {
          email: tenant.email,
          name: `${spec.firstName} ${spec.lastName}`,
          passwordHash,
          role: "TENANT",
        },
      });
      await db.tenant.update({ where: { id: tenant.id }, data: { userId: portalUser.id } });
    }

    leases.push({
      id: lease.id,
      tenantId: tenant.id,
      tenantFirstName: spec.firstName,
      tenantLastName: spec.lastName,
      unitLabel: spec.unit,
      scenario: spec.scenario,
      rentCents,
      dueDay,
      startedMonthsAgo: spec.startedMonthsAgo,
      paymentRail: spec.paymentRail === "plaid" && useLivePlaid ? "plaid" : "manual",
    });
  }

  // --- Noah's lease document: sent for signature, landlord side already
  // countersigned, tenant side left blank for the live simulation to complete
  // through the actual portal signing flow. -----------------------------------
  {
    const {
      DEFAULT_TEMPLATE_BODY,
      renderLeaseDocument,
      defaultDocumentTitle,
      defaultSelectedClauseIds,
    } = await import("../src/lib/lease-document");

    const template = await db.leaseTemplate.create({
      data: { organizationId: org.id, name: "Standard residential lease", body: DEFAULT_TEMPLATE_BODY },
    });

    const noahLease = leases.find((l) => l.scenario === "brand_new")!;
    const full = await db.lease.findUniqueOrThrow({
      where: { id: noahLease.id },
      select: {
        rentAmountCents: true,
        depositCents: true,
        startDate: true,
        endDate: true,
        rentDueDay: true,
        tenant: { select: { firstName: true, lastName: true, email: true } },
        unit: {
          select: {
            label: true,
            property: {
              select: { name: true, addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true },
            },
          },
        },
        organization: { select: { name: true, graceDays: true, lateFeeCents: true } },
      },
    });

    const body = renderLeaseDocument({
      templateBody: template.body,
      lease: full,
      selectedClauseIds: defaultSelectedClauseIds(),
    });

    const document = await db.leaseDocument.create({
      data: {
        organizationId: org.id,
        leaseId: noahLease.id,
        templateId: template.id,
        title: defaultDocumentTitle(full),
        body,
        status: "SENT",
        sentAt: new Date(),
        createdById: admin.id,
      },
    });
    await db.leaseSignature.create({
      data: {
        documentId: document.id,
        role: "LANDLORD",
        signerName: admin.name,
        signerEmail: admin.email,
        signedAt: new Date(),
        typedSignature: admin.name,
      },
    });
    // Tenant row left unsigned on purpose — the live simulation signs it
    // through the actual /portal signing flow.
    await db.leaseSignature.create({
      data: {
        documentId: document.id,
        role: "TENANT",
        signerName: `${full.tenant.firstName} ${full.tenant.lastName}`,
        signerEmail: full.tenant.email,
      },
    });
  }

  // --- Charge / payment history, per scenario --------------------------------
  let chargeCount = 0;
  let paymentCount = 0;

  // Charges for a "plaid" rail lease are created below like everyone else's,
  // but deliberately get no Payment rows written here — those come from the
  // real Plaid Sandbox sync in the bank-feed block further down, once a
  // connection exists to sync them through.
  const plaidTrackedLeases: {
    leaseId: string;
    tenantFirstName: string;
    tenantLastName: string;
    unitLabel: string;
    charges: { id: string; amountCents: number; dueDate: Date }[];
  }[] = [];

  for (const lease of leases) {
    if (lease.scenario === "brand_new") continue; // no billing history yet — that's the point

    const billCount = Math.min(lease.startedMonthsAgo, 8);
    const charges: { id: string; amountCents: number; dueDate: Date }[] = [];

    for (let back = billCount; back >= 0; back -= 1) {
      const period = monthsAgo(back);
      const dueDate = utc(period.getUTCFullYear(), period.getUTCMonth() + 1, lease.dueDay);
      const charge = await db.charge.create({
        data: {
          leaseId: lease.id,
          type: "RENT",
          amountCents: lease.rentCents,
          dueDate,
          periodStart: period,
          description: `Rent — ${period.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}`,
        },
      });
      charges.push({ id: charge.id, amountCents: charge.amountCents, dueDate });
      chargeCount += 1;
    }

    const unpaidTail = lease.scenario === "late" ? 1 : 0;
    const settledCount = Math.max(0, charges.length - unpaidTail);

    if (lease.paymentRail === "plaid") {
      plaidTrackedLeases.push({
        leaseId: lease.id,
        tenantFirstName: lease.tenantFirstName,
        tenantLastName: lease.tenantLastName,
        unitLabel: lease.unitLabel,
        charges: charges.slice(0, settledCount),
      });
    } else if (lease.scenario === "hap_split") {
      const subsidyCents = Math.round(lease.rentCents * 0.4);
      for (let i = 0; i < settledCount; i += 1) {
        const charge = charges[i];
        await db.payment.create({
          data: {
            organizationId: org.id,
            leaseId: lease.id,
            chargeId: charge.id,
            amountCents: subsidyCents,
            status: "SUCCEEDED",
            source: "IMPORT_HAP",
            reconciliationStatus: "MATCHED",
            paidAt: new Date(charge.dueDate.getTime() - 2 * 86_400_000),
            payerNameRaw: "ADA COUNTY HOUSING AUTHORITY",
            memo: "HAP subsidy payment",
          },
        });
        paymentCount += 1;
        await db.payment.create({
          data: {
            organizationId: org.id,
            leaseId: lease.id,
            chargeId: charge.id,
            amountCents: charge.amountCents - subsidyCents,
            status: "SUCCEEDED",
            source: i % 2 === 0 ? "IMPORT_VENMO" : "MANUAL_CASH",
            reconciliationStatus: "MATCHED",
            paidAt: new Date(charge.dueDate.getTime() + (i % 3) * 86_400_000),
            memo: "Tenant portion",
          },
        });
        paymentCount += 1;
      }
    } else {
      for (let i = 0; i < settledCount; i += 1) {
        const charge = charges[i];
        const method: Prisma.PaymentCreateInput["method"] = i % 4 === 0 ? "MANUAL" : "ACH";
        await db.payment.create({
          data: {
            organizationId: org.id,
            leaseId: lease.id,
            chargeId: charge.id,
            amountCents: charge.amountCents,
            status: "SUCCEEDED",
            method,
            source: method === "MANUAL" ? "MANUAL_CASH" : "STRIPE_NATIVE",
            reconciliationStatus: "MATCHED",
            paidAt: new Date(charge.dueDate.getTime() + (i % 3) * 86_400_000),
            memo: method === "MANUAL" ? `Check #${3100 + i}` : "Online payment",
          },
        });
        paymentCount += 1;
      }
    }

    if (lease.scenario === "late") {
      await db.charge.create({
        data: {
          leaseId: lease.id,
          type: "LATE_FEE",
          amountCents: 6000,
          dueDate: new Date(),
          description: "Late fee — overdue balance",
        },
      });
      chargeCount += 1;
    }
  }

  // --- Maintenance: one open (left for the live simulation to submit and
  // assign), one already resolved with history --------------------------------
  const vendor1 = await db.vendor.create({
    data: {
      organizationId: org.id,
      name: "Ridge Plumbing & Rooter",
      trade: "Plumbing",
      contactName: "Dale Whitcomb",
      email: "dale@ridgeplumbing.example.com",
      phone: "208-555-9001",
      active: true,
    },
  });
  await db.vendor.create({
    data: {
      organizationId: org.id,
      name: "Boise Handy Crew",
      trade: "General repair",
      contactName: "Priya Nair",
      email: "priya@boisehandycrew.example.com",
      phone: "208-555-9002",
      active: true,
    },
  });

  const harperLease = leases.find((l) => l.scenario === "maintenance_done")!;
  const harper = await db.lease.findUniqueOrThrow({ where: { id: harperLease.id }, select: { unitId: true } });
  await db.maintenanceRequest.create({
    data: {
      organizationId: org.id,
      unitId: harper.unitId,
      leaseId: harperLease.id,
      createdByUserId: admin.id,
      assignedVendorId: vendor1.id,
      title: "Bathroom sink draining slowly",
      description: "Water pools for a while before draining. Not backed up, just slow.",
      priority: "NORMAL",
      status: "RESOLVED",
      resolvedAt: daysAgo(5),
      notes: {
        create: {
          authorId: admin.id,
          body: "Snaked the line — hair clog. Confirmed draining normally with tenant.",
          internal: false,
        },
      },
    },
  });
  // Caleb's request is intentionally NOT seeded here — see the live
  // simulation, which submits it from the tenant portal and assigns the
  // vendor from staff, exercising the whole flow rather than its end state.

  // --- Live Plaid Sandbox bank connection, if configured ---------------------
  // Best-effort, mirroring the Stripe block above: a missing/invalid key, the
  // Sandbox API rejecting a call, or a network hiccup must never abort the
  // seed. Caleb's rent history (see paymentRail on the cast list above) only
  // exists once this succeeds — real transactions pulled through the real
  // syncBankConnection pipeline, not Payment rows written by hand, so the
  // bank feed is proven end-to-end the same way the Stripe account is.
  let bankFeedSummary: string;
  if (plaidTrackedLeases.length === 0) {
    bankFeedSummary = useLivePlaid
      ? "Plaid: connected, nothing to sync"
      : "Plaid: not configured, skipped (Caleb's rent recorded manually instead)";
  } else {
    try {
      const { getPlaid, exchangePublicToken, getInstitutionInfo } = await import("../src/lib/plaid");
      const { encryptToken } = await import("../src/lib/token-encryption");
      const { syncBankConnection } = await import("../src/lib/plaid-sync");

      // Two dead ends worth recording before explaining what this does instead:
      //
      //  - Plaid Sandbox's injected-transaction endpoint (sandboxTransactionsCreate,
      //    what the "Simulate deposit" sandbox tool uses) refuses to backdate past
      //    14 days ("date_posted must be within the last 14 days"), so months-old
      //    deposits can't be created through it at all.
      //  - The "dynamic" test user that endpoint requires (user_transactions_dynamic)
      //    generates its own large, constantly-mutating transaction history on top
      //    of anything injected — great for testing sync robustness, unusable for a
      //    clean demo (an injected deposit routinely got lost in it, and repeated
      //    syncs kept surfacing more invented transactions rather than converging).
      //
      // A Sandbox Custom User sidesteps both: transaction history is defined once,
      // as literal (date, amount, description) rows, at Item-creation time — no
      // 14-day floor, no background noise. Its downside is the one this code works
      // around: only the most recently dated row survives to show up on sync, so
      // only the current period's deposit can go through the live pipeline this
      // way. Everything before it is written as already-synced bank-feed history
      // instead (below) — which is what those months would look like today even in
      // the real-money case, since a newly connected feed doesn't retroactively
      // invent months that predate it either.
      const currentDeposits = plaidTrackedLeases
        .map((tracked) => ({ tracked, charge: tracked.charges.at(-1) }))
        .filter((x): x is { tracked: (typeof plaidTrackedLeases)[number]; charge: NonNullable<typeof x.charge> } =>
          Boolean(x.charge),
        );

      const sandboxToken = await getPlaid().sandboxPublicTokenCreate({
        institution_id: "ins_109508",
        initial_products: [Products.Transactions],
        options: {
          override_username: "user_custom",
          override_password: JSON.stringify({
            override_accounts: [
              {
                type: "depository",
                subtype: "checking",
                starting_balance: 5_00000,
                transactions: currentDeposits.map(({ tracked, charge }) => {
                  const date = new Date().toISOString().slice(0, 10);
                  return {
                    date_transacted: date,
                    date_posted: date,
                    amount: -(charge.amountCents / 100),
                    description: `${tracked.tenantFirstName} ${tracked.tenantLastName} RENT UNIT ${tracked.unitLabel}`,
                  };
                }),
              },
            ],
          }),
        },
      });
      const { accessToken, itemId } = await exchangePublicToken(sandboxToken.data.public_token);
      const institution = await getInstitutionInfo(accessToken).catch(() => ({ name: null, logo: null }));
      const accessTokenEncrypted = await encryptToken(accessToken);

      const bankConnection = await db.bankConnection.create({
        data: {
          organizationId: org.id,
          plaidItemId: itemId,
          accessTokenEncrypted,
          institutionName: institution.name,
          institutionLogo: institution.logo,
          status: "ACTIVE",
        },
      });

      let historicalCount = 0;
      for (const tracked of plaidTrackedLeases) {
        for (const charge of tracked.charges.slice(0, -1)) {
          await db.payment.create({
            data: {
              organizationId: org.id,
              leaseId: tracked.leaseId,
              chargeId: charge.id,
              amountCents: charge.amountCents,
              status: "SUCCEEDED",
              source: "IMPORT_PLAID",
              reconciliationStatus: "MATCHED",
              paidAt: new Date(charge.dueDate.getTime() + 86_400_000),
              payerNameRaw: `${tracked.tenantFirstName.toUpperCase()} ${tracked.tenantLastName.toUpperCase()}`,
              memo: `${tracked.tenantFirstName} ${tracked.tenantLastName} RENT UNIT ${tracked.unitLabel}`,
              externalRef: `seed-plaid-${charge.id}`,
            },
          });
          paymentCount += 1;
          historicalCount += 1;
        }
      }

      // Sandbox needs a beat before a fresh Item's transactions show up in a sync.
      await new Promise((resolve) => setTimeout(resolve, 2000));

      let synced = 0;
      let hasMore = true;
      while (hasMore) {
        const outcome = await syncBankConnection(bankConnection.id);
        synced += outcome.added;
        hasMore = outcome.hasMore;
      }
      paymentCount += synced;

      bankFeedSummary = `Plaid Sandbox bank connection: ${institution.name ?? "First Platypus Bank"} (test mode, live) — ${historicalCount} past month${historicalCount === 1 ? "" : "s"} of Caleb's rent already on the books via the bank feed, ${synced} more deposit${synced === 1 ? "" : "s"} synced live just now`;
      console.log(`• created live Plaid Sandbox bank connection: ${historicalCount} past deposits + ${synced} synced live for Caleb`);
    } catch (err) {
      bankFeedSummary = "Plaid: configured but the Sandbox connection failed, skipped (Caleb's rent recorded manually instead)";
      console.warn(`• skipped Plaid Sandbox bank connection (${err instanceof Error ? err.message : err})`);
      // Fall back to writing Caleb's payments by hand, same as every other
      // "current" tenant, so the seed still ends in a complete, paid-up state
      // even if Sandbox itself misbehaves.
      for (const tracked of plaidTrackedLeases) {
        for (const charge of tracked.charges) {
          await db.payment.create({
            data: {
              organizationId: org.id,
              leaseId: tracked.leaseId,
              chargeId: charge.id,
              amountCents: charge.amountCents,
              status: "SUCCEEDED",
              method: "MANUAL",
              source: "MANUAL_CASH",
              reconciliationStatus: "MATCHED",
              paidAt: new Date(charge.dueDate.getTime() + 86_400_000),
              memo: "Recorded manually — Plaid Sandbox connection failed during seeding",
            },
          });
          paymentCount += 1;
        }
      }
    }
  }

  const { applyReconciliationForOrganization } = await import("../src/lib/reconciliation");
  await applyReconciliationForOrganization(org.id);

  console.log(`
✓ Seeded ${ORG_NAME}
  1 property · 10 units · 8 active leases · 2 prospects
  ${chargeCount} charges · ${paymentCount} payments · 1 resolved maintenance request
  ${stripeAccountId ? `Stripe Connect account: ${stripeAccountId} (test mode, live)` : "Stripe: not configured, skipped"}
  ${bankFeedSummary}

  Sign in with password: ${PASSWORD}
    landlord10@example.com     admin (the landlord)
    noah.kim@example.com       brand-new lease, unsigned lease document
    isabella.cruz@example.com  current, will pay online (demo payment)
    ethan.brooks@example.com   current, paid by staff (manual cash)
    sophia.reyes@example.com   current, paid via bank-statement import
    liam.foster@example.com    behind on rent (late)
    zoe.whitaker@example.com   HAP-subsidized, split payment
    caleb.nguyen@example.com   rent auto-tracked via the bank feed (Plaid); about to file a maintenance request
    harper.diaz@example.com    maintenance already resolved

  Still prospects (no login): Ava Thompson (submitted), Marcus Webb (screened, approved)
`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
