/**
 * Creates a PENDING online payment against the seeded demo tenant's lease, the
 * way an abandoned Stripe Checkout would leave one behind.
 *
 * Local-only scaffolding for exercising cancelPendingOnlinePaymentAction:
 * startRentPaymentAction is the only thing that writes these rows in real use,
 * and it can't run without a Stripe key, so there's otherwise no way to get the
 * "Awaiting payment" state in front of a browser. Deliberately writes no
 * stripeCheckoutSessionId — with one set the action would call out to Stripe,
 * which is exactly the path that can't run here.
 */
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";

const raw = process.env.DATABASE_URL;
if (!raw?.startsWith("file:")) {
  throw new Error("Refusing to run: DATABASE_URL is not a local sqlite file.");
}
const rel = raw.replace(/^file:/, "");
const url = path.isAbsolute(rel) ? raw : `file:${path.join(process.cwd(), "prisma", rel)}`;

const db = new PrismaClient({ adapter: new PrismaBetterSQLite3({ url }) });

const lease = await db.lease.findFirst({
  where: { tenant: { email: "tenant@example.com" } },
  select: { id: true, organizationId: true, rentAmountCents: true },
});
if (!lease) throw new Error("No lease for tenant@example.com — run npm run db:seed first.");

const payment = await db.payment.create({
  data: {
    organizationId: lease.organizationId,
    leaseId: lease.id,
    amountCents: lease.rentAmountCents,
    method: "ACH",
    source: "STRIPE_NATIVE",
    status: "PENDING",
    memo: "Online payment",
  },
  select: { id: true },
});

console.log(`lease=${lease.id} payment=${payment.id}`);
await db.$disconnect();
