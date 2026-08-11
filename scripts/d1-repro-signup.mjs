#!/usr/bin/env node
// Diagnostic, not a fixture: reproduces signupAction's exact database calls
// against the real production D1 database, from plain Node (this script),
// rather than from inside the Worker.
//
// Why this and not just reading the Worker's logs: I don't have a Cloudflare
// token scoped for that (deliberately — the D1 workflow's token is scoped to
// D1 only), and the production Worker sits behind Cloudflare Access, which I
// have no way to authenticate against from here, and shouldn't try to route
// around. This sidesteps both: Cloudflare's D1 REST API needs exactly the
// D1:Edit scope the existing token already has, and it's reachable directly
// from a GitHub Actions runner with no Worker and no Access in the way.
//
// The point of running in plain Node rather than inside a Worker is that
// runAction() (src/lib/forms.ts) catches every unexpected exception and
// returns the same generic "Something went wrong on our end" — which is
// exactly what's been reported, and which is *why* the real cause has been
// invisible so far. This script makes the same two database calls signupAction
// makes, with nothing catching or generalizing the error, so whatever actually
// throws prints in full: message, stack, and cause.
//
// Cleans up whatever it creates, in a finally block, so a successful run
// leaves no trace and a failed one leaves at most the one row that failed to
// clean up (reported explicitly if so).

import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";

const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_DATABASE_ID } = process.env;
for (const [name, value] of Object.entries({
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_DATABASE_ID,
})) {
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
}

const adapter = new PrismaD1({
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_DATABASE_ID,
  // The adapter's HTTP mode just wants a D1-scoped API token under this name;
  // it's the same secret already used for everything else in this workflow.
  CLOUDFLARE_D1_TOKEN: CLOUDFLARE_API_TOKEN,
});
const prisma = new PrismaClient({ adapter });

const stamp = Date.now();
const email = `diagnostic-repro-${stamp}@example.invalid`;
const orgName = `Diagnostic Repro ${stamp}`;
let createdOrgId = null;
let createdUserId = null;

try {
  console.log("Step 1: check for an existing user with this email (signupAction's first read)");
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  console.log("  ->", existing ? "found (unexpected — email should be new)" : "none, as expected");

  console.log("Step 2: the same $transaction signupAction runs — create Organization, then User");
  await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: orgName } });
    createdOrgId = org.id;
    console.log("  -> Organization created:", org.id);

    const user = await tx.user.create({
      data: {
        email,
        name: "Diagnostic Repro",
        passwordHash: "not-a-real-hash-this-is-only-a-repro",
        role: "ADMIN",
        organizationId: org.id,
      },
    });
    createdUserId = user.id;
    console.log("  -> User created:", user.id);
  });

  console.log("\nBoth writes succeeded. Signup's own database logic is NOT what's failing.");
} catch (err) {
  console.log("\n=== THE REAL ERROR (this is what runAction's catch-all was hiding) ===");
  console.error(err);
  if (err && typeof err === "object") {
    for (const key of ["name", "code", "message", "cause", "stack"]) {
      if (key in err) console.error(`\n-- ${key} --\n${err[key]}`);
    }
  }
  process.exitCode = 1;
} finally {
  // Best-effort cleanup — never let a diagnostic leave test data behind.
  try {
    if (createdUserId) {
      await prisma.user.delete({ where: { id: createdUserId } });
      console.log("\nCleaned up the test User row.");
    }
    if (createdOrgId) {
      await prisma.organization.delete({ where: { id: createdOrgId } });
      console.log("Cleaned up the test Organization row.");
    }
  } catch (cleanupErr) {
    console.error("\n::warning::Cleanup failed — a diagnostic row may remain:", cleanupErr);
    console.error(`  Organization id: ${createdOrgId ?? "(none created)"}`);
    console.error(`  User id: ${createdUserId ?? "(none created)"}`);
  }
  await prisma.$disconnect();
}
