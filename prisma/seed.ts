/**
 * Demo data: one 34-unit portfolio with realistic messiness — a couple of
 * tenants behind on rent, one in the grace period, an in-flight ACH payment,
 * open maintenance requests, and an owner who can see only one property.
 *
 * Run with: npm run db:seed  (destructive — wipes the demo org first)
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();

const PASSWORD = "demo-password-123";
const ORG_NAME = "Cedar & Vine Property Group";

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

function monthsAgo(n: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 1));
}

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  // Idempotent-ish: drop the demo org and everything cascading from it.
  const existing = await db.organization.findFirst({ where: { name: ORG_NAME } });
  if (existing) {
    // Tenant users aren't cascaded from the org (they hang off Tenant), so
    // collect them before the org goes.
    const tenantUsers = await db.user.findMany({
      where: { organizationId: existing.id },
      select: { id: true },
    });
    await db.organization.delete({ where: { id: existing.id } });
    await db.user.deleteMany({ where: { id: { in: tenantUsers.map((u) => u.id) } } });
    console.log("• removed previous demo data");
  }

  const org = await db.organization.create({
    data: { name: ORG_NAME, graceDays: 5, lateFeeCents: 7500 },
  });

  await db.user.createMany({
    data: [
      {
        email: "admin@example.com",
        name: "Dana Whitfield",
        passwordHash,
        role: "ADMIN",
        organizationId: org.id,
      },
      {
        email: "staff@example.com",
        name: "Marcus Lee",
        passwordHash,
        role: "STAFF",
        organizationId: org.id,
      },
      {
        email: "owner@example.com",
        name: "Priya Raman",
        passwordHash,
        role: "OWNER",
        organizationId: org.id,
      },
    ],
  });

  const propertySpecs = [
    {
      name: "Cedar Court",
      addressLine1: "418 Cedar Street",
      city: "Portland",
      state: "OR",
      postalCode: "97205",
      units: 12,
      baseRent: 1_650_00,
    },
    {
      name: "Vine Street Flats",
      addressLine1: "77 Vine Street",
      city: "Portland",
      state: "OR",
      postalCode: "97209",
      units: 18,
      baseRent: 1_895_00,
    },
    {
      name: "Alder House",
      addressLine1: "1290 SE Alder Avenue",
      city: "Portland",
      state: "OR",
      postalCode: "97214",
      units: 4,
      baseRent: 2_250_00,
    },
  ];

  const properties = [];
  for (const spec of propertySpecs) {
    const property = await db.property.create({
      data: {
        organizationId: org.id,
        name: spec.name,
        addressLine1: spec.addressLine1,
        city: spec.city,
        state: spec.state,
        postalCode: spec.postalCode,
        notes: spec.name === "Alder House" ? "Roof replaced 2024. Boiler is original — watch it." : null,
        units: {
          create: Array.from({ length: spec.units }, (_, i) => {
            const floor = Math.floor(i / 4) + 1;
            const letter = String.fromCharCode(65 + (i % 4));
            const bedrooms = i % 5 === 0 ? 1 : i % 7 === 0 ? 3 : 2;
            return {
              label: `${floor}${letter}`,
              bedrooms,
              bathrooms: bedrooms >= 3 ? 2 : 1,
              sqft: 620 + bedrooms * 240,
              marketRentCents: spec.baseRent + bedrooms * 150_00,
              status: "VACANT" as const,
            };
          }),
        },
      },
      include: { units: { orderBy: { label: "asc" } } },
    });
    properties.push(property);
  }

  // Give the owner visibility into one property only, to exercise scoping.
  const ownerUser = await db.user.findUniqueOrThrow({ where: { email: "owner@example.com" } });
  await db.propertyOwner.create({
    data: { userId: ownerUser.id, propertyId: properties[2].id },
  });

  const people = [
    ["Alicia", "Fernandez"], ["Tom", "Nakamura"], ["Grace", "Obi"], ["Ben", "Kowalski"],
    ["Sofia", "Ruiz"], ["Elias", "Bergström"], ["Nadia", "Haddad"], ["Chris", "Donnelly"],
    ["Mei", "Chen"], ["Jonah", "Alvarez"], ["Ruth", "Mbeki"], ["Peter", "Vasquez"],
    ["Hana", "Yilmaz"], ["Owen", "Brady"], ["Lucia", "Moretti"], ["Sam", "Osei"],
    ["Ingrid", "Larsen"], ["Dev", "Patel"], ["Claire", "Beaumont"], ["Yusuf", "Rahman"],
    ["Tessa", "Lindqvist"], ["Andre", "Silva"], ["Mona", "Kaur"], ["Felix", "Wagner"],
    ["Rosa", "Delgado"], ["Kwame", "Boateng"], ["Anna", "Novak"], ["Leo", "Fitzgerald"],
  ] as const;

  const allUnits = properties.flatMap((p) => p.units.map((u) => ({ ...u, property: p })));

  // Lease ~85% of units so occupancy and vacancy loss are both non-trivial.
  const leaseCount = Math.min(people.length, Math.floor(allUnits.length * 0.85));

  type Scenario =
    | "current"
    | "grace"
    | "late"
    | "very_late"
    | "in_flight"
    | "credit"
    | "hap_split"
    | "hap_split_short";

  const leases: {
    id: string;
    scenario: Scenario;
    rentCents: number;
    dueDay: number;
    startedMonthsAgo: number;
    subsidyCents: number | null;
  }[] = [];

  for (let i = 0; i < leaseCount; i += 1) {
    const [firstName, lastName] = people[i];
    const unit = allUnits[i];

    const tenant = await db.tenant.create({
      data: {
        organizationId: org.id,
        firstName,
        lastName,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/[^a-z]/g, "")}@example.com`,
        phone: `503-555-${String(1000 + i).slice(-4)}`,
      },
    });

    // A deterministic spread of situations, so the demo always shows the same
    // interesting states rather than a random and possibly boring set.
    const scenario: Scenario =
      i === 0 ? "very_late"
      : i === 1 ? "late"
      : i === 2 ? "grace"
      : i === 3 ? "in_flight"
      : i === 4 ? "credit"
      : i === 5 ? "hap_split"
      : i === 6 ? "hap_split_short"
      : "current";

    const startedMonthsAgo = 3 + (i % 9);
    const rentCents = unit.marketRentCents - (i % 3) * 25_00;
    const dueDay = i % 4 === 0 ? 5 : 1;
    // A little under half the rent, on a HAP-split lease — the tenant covers
    // the rest. Chosen so it never evenly divides the total, which is the
    // realistic case and exercises the "combined total, not exact halves" rule.
    const subsidyCents =
      scenario === "hap_split" || scenario === "hap_split_short"
        ? Math.round(rentCents * 0.42)
        : null;

    const lease = await db.lease.create({
      data: {
        organizationId: org.id,
        unitId: unit.id,
        tenantId: tenant.id,
        status: "ACTIVE",
        startDate: monthsAgo(startedMonthsAgo),
        endDate: utc(
          monthsAgo(startedMonthsAgo).getUTCFullYear() + 1,
          monthsAgo(startedMonthsAgo).getUTCMonth() + 1,
          1,
        ),
        rentAmountCents: rentCents,
        depositCents: rentCents,
        rentDueDay: dueDay,
        subsidyOwedCents: subsidyCents,
        subsidyPayerName: subsidyCents !== null ? "Portland Housing Authority" : null,
      },
    });

    await db.unit.update({ where: { id: unit.id }, data: { status: "OCCUPIED" } });
    leases.push({ id: lease.id, scenario, rentCents, dueDay, startedMonthsAgo, subsidyCents });
  }

  // Mark two unleased units as off-market so the status enum is exercised.
  const vacant = await db.unit.findMany({
    where: { property: { organizationId: org.id }, status: "VACANT" },
    take: 2,
    select: { id: true },
  });
  await db.unit.updateMany({
    where: { id: { in: vacant.map((u) => u.id) } },
    data: { status: "MAINTENANCE" },
  });

  // --- Charges and payments -------------------------------------------------
  // Build the rent history month by month, then pay it off according to each
  // lease's scenario.
  let chargeCount = 0;
  let paymentCount = 0;

  for (const lease of leases) {
    const monthsToBill = Math.min(lease.startedMonthsAgo, 12);
    const charges: { id: string; amountCents: number; dueDate: Date }[] = [];

    for (let back = monthsToBill; back >= 0; back -= 1) {
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

    // How many of the oldest charges get paid in full, and how.
    // hap_split_short leaves the tenant's last 2 months unpaid (HAP's share
    // still shows up on time) — genuinely uncovered, with no later payment
    // to ever catch it up, which is what makes SHORT durable rather than a
    // shortfall that resolves itself into merely LATE a month later.
    const unpaidTail =
      lease.scenario === "very_late" ? 3
      : lease.scenario === "late" ? 1
      : lease.scenario === "grace" ? 1
      : lease.scenario === "in_flight" ? 1
      : lease.scenario === "hap_split_short" ? 2
      : 0;

    const settledCount = Math.max(0, charges.length - unpaidTail);

    if (lease.scenario === "hap_split" || lease.scenario === "hap_split_short") {
      // Every month, the housing authority's share arrives separately from
      // the tenant's — two payments, two sources, one charge, always summing
      // to the full charge.
      const subsidyCents = lease.subsidyCents!;

      for (let i = 0; i < settledCount; i += 1) {
        const charge = charges[i];
        const hapPaidAt = new Date(charge.dueDate.getTime() - 2 * 86_400_000); // HAP pays a couple days early
        const tenantPaidAt = new Date(charge.dueDate.getTime() + (i % 3) * 86_400_000);

        await db.payment.create({
          data: {
            organizationId: org.id,
            leaseId: lease.id,
            chargeId: charge.id,
            amountCents: subsidyCents,
            status: "SUCCEEDED",
            source: "IMPORT_HAP",
            reconciliationStatus: "MATCHED",
            paidAt: hapPaidAt,
            payerNameRaw: "PORTLAND HOUSING AUTHORITY",
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
            paidAt: tenantPaidAt,
            memo: "Tenant portion",
          },
        });
        paymentCount += 1;
      }

      // hap_split_short's unpaid tail: the housing authority keeps paying
      // its share on time even though the tenant has stopped paying theirs
      // — a realistic (and common) way a subsidized lease goes short.
      if (lease.scenario === "hap_split_short") {
        for (let i = settledCount; i < charges.length; i += 1) {
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
              payerNameRaw: "PORTLAND HOUSING AUTHORITY",
              memo: "HAP subsidy payment",
            },
          });
          paymentCount += 1;
        }
      }
    } else {
      for (let i = 0; i < settledCount; i += 1) {
        const charge = charges[i];
        const paidAt = new Date(charge.dueDate.getTime() + (i % 3) * 86_400_000);
        const method: Prisma.PaymentCreateInput["method"] = i % 5 === 0 ? "MANUAL" : "ACH";
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
            paidAt,
            memo: method === "MANUAL" ? `Check #${2100 + i}` : "Online payment",
          },
        });
        paymentCount += 1;
      }
    }

    // The in-flight case: this month's rent submitted but still clearing.
    if (lease.scenario === "in_flight") {
      const last = charges[charges.length - 1];
      await db.payment.create({
        data: {
          organizationId: org.id,
          leaseId: lease.id,
          chargeId: last.id,
          amountCents: last.amountCents,
          status: "PROCESSING",
          method: "ACH",
          source: "STRIPE_NATIVE",
          reconciliationStatus: "MATCHED",
          memo: "Online payment",
        },
      });
      paymentCount += 1;
    }

    // The credit case: paid a month ahead.
    if (lease.scenario === "credit") {
      await db.payment.create({
        data: {
          organizationId: org.id,
          leaseId: lease.id,
          amountCents: lease.rentCents,
          status: "SUCCEEDED",
          method: "ACH",
          source: "STRIPE_NATIVE",
          reconciliationStatus: "MATCHED",
          paidAt: new Date(),
          memo: "Paid ahead",
        },
      });
      paymentCount += 1;
    }

    // Late fee on the worst offender, so ad-hoc charges appear somewhere.
    if (lease.scenario === "very_late") {
      await db.charge.create({
        data: {
          leaseId: lease.id,
          type: "LATE_FEE",
          amountCents: 7500,
          dueDate: new Date(),
          description: "Late fee — overdue balance",
        },
      });
      chargeCount += 1;
    }
  }

  // --- Maintenance ----------------------------------------------------------
  const staff = await db.user.findUniqueOrThrow({ where: { email: "staff@example.com" } });

  const requestSpecs = [
    {
      title: "No hot water in the shower",
      description:
        "Hot water ran out two days ago and hasn't come back. Cold water is fine. The tank in the closet is making a clicking noise.",
      priority: "URGENT" as const,
      status: "IN_PROGRESS" as const,
      note: "Plumber booked for tomorrow 9-11am. Tenant will be home.",
    },
    {
      title: "Kitchen faucet dripping",
      description: "Steady drip from the base of the faucet. Not urgent but it's getting worse.",
      priority: "NORMAL" as const,
      status: "OPEN" as const,
      note: null,
    },
    {
      title: "Front entry light out",
      description: "The light over the main entrance has been out for about a week. Dark coming home.",
      priority: "HIGH" as const,
      status: "OPEN" as const,
      note: null,
    },
    {
      title: "Bedroom window won't latch",
      description: "The latch on the back bedroom window spins without catching.",
      priority: "NORMAL" as const,
      status: "RESOLVED" as const,
      note: "Replaced the latch hardware. Confirmed working with tenant.",
    },
    {
      title: "Dishwasher not draining",
      description: "Standing water at the bottom after every cycle.",
      priority: "NORMAL" as const,
      status: "OPEN" as const,
      note: null,
    },
  ];

  const leasesForRequests = await db.lease.findMany({
    where: { organizationId: org.id },
    take: requestSpecs.length,
    select: { id: true, unitId: true },
  });

  for (const [i, spec] of requestSpecs.entries()) {
    const target = leasesForRequests[i % leasesForRequests.length];
    await db.maintenanceRequest.create({
      data: {
        organizationId: org.id,
        unitId: target.unitId,
        leaseId: target.id,
        createdByUserId: staff.id,
        title: spec.title,
        description: spec.description,
        priority: spec.priority,
        status: spec.status,
        resolvedAt: spec.status === "RESOLVED" ? new Date() : null,
        notes: spec.note
          ? { create: { authorId: staff.id, body: spec.note, internal: false } }
          : undefined,
      },
    });
  }

  // A portal login for the most-behind tenant, so the tenant flow is walkable.
  const firstLease = await db.lease.findFirstOrThrow({
    where: { organizationId: org.id },
    orderBy: { createdAt: "asc" },
    include: { tenant: true },
  });
  const tenantUser = await db.user.create({
    data: {
      email: "tenant@example.com",
      name: `${firstLease.tenant.firstName} ${firstLease.tenant.lastName}`,
      passwordHash,
      role: "TENANT",
    },
  });
  await db.tenant.update({
    where: { id: firstLease.tenantId },
    data: { userId: tenantUser.id, email: "tenant@example.com" },
  });

  // An unmatched import: a Cash App payment that landed with a payer name
  // that doesn't correspond to anyone on file — exactly the kind of thing
  // the "unmatched payments" panel exists to surface.
  await db.payment.create({
    data: {
      organizationId: org.id,
      leaseId: null,
      amountCents: 92_000,
      status: "SUCCEEDED",
      source: "IMPORT_CASHAPP",
      reconciliationStatus: "UNMATCHED",
      paidAt: monthsAgo(0),
      payerNameRaw: "$randomhandle22",
      memo: "Cash App transfer",
    },
  });
  paymentCount += 1;

  // Every status above was written as a reasonable placeholder at insert
  // time — this is the one pass that actually runs the reconciliation engine
  // against the real charge history, so the demo data shows genuinely
  // computed MATCHED/SHORT/LATE calls rather than hand-set ones.
  const { applyReconciliationForOrganization } = await import("../src/lib/reconciliation");
  await applyReconciliationForOrganization(org.id);

  const unitTotal = await db.unit.count({ where: { property: { organizationId: org.id } } });

  console.log(`
✓ Seeded ${ORG_NAME}
  ${properties.length} properties · ${unitTotal} units · ${leases.length} active leases
  ${chargeCount} charges · ${paymentCount} payments · ${requestSpecs.length} maintenance requests

  Sign in with password: ${PASSWORD}
    admin@example.com    full access
    staff@example.com    day-to-day management
    owner@example.com    read-only, Alder House only
    tenant@example.com   resident portal (this one is behind on rent)
`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
