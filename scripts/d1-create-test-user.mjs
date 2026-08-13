#!/usr/bin/env node
// One-off: creates a real Organization + ADMIN User in production D1, for
// testing flows that need a genuine account (currently: does a password-reset
// email actually get delivered, now that EMAIL_FROM and Email Routing are
// live). Mirrors signupAction's exact shape (src/app/(auth)/actions.ts) —
// same two calls, same hashPassword — so the account this creates is
// identical to one that came through real signup, not a special case.
//
// Deliberately takes the email as a required env var rather than a hardcoded
// default: this script is committed to the repo, and a personal email address
// baked into source is not something to leave lying around.
//
// Not auto-cleaned up like scripts/d1-repro-signup.mjs — the whole point is
// for a human to click through the actual reset flow afterward, which takes
// longer than a script's lifetime. Safe to leave indefinitely (it's an inert
// test account) or delete later; nothing else references it.

import { PrismaClient } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import bcrypt from "bcryptjs";

const { CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_DATABASE_ID, TEST_USER_EMAIL } =
  process.env;

for (const [name, value] of Object.entries({
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_DATABASE_ID,
  TEST_USER_EMAIL,
})) {
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
}

const adapter = new PrismaD1({
  CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_DATABASE_ID,
  CLOUDFLARE_D1_TOKEN: CLOUDFLARE_API_TOKEN,
});
const prisma = new PrismaClient({ adapter });

try {
  const existing = await prisma.user.findUnique({
    where: { email: TEST_USER_EMAIL },
    select: { id: true },
  });
  if (existing) {
    console.log(`A user with this email already exists (id ${existing.id}) — nothing to do.`);
    console.log("Go straight to the login page's Forgot password link.");
    process.exitCode = 0;
  } else {
    // Same shape as signupAction, same hashPassword (bcrypt cost 12). The
    // password itself is thrown away immediately — this account is only ever
    // meant to be reached via the reset-password flow, never logged into
    // directly.
    const passwordHash = await bcrypt.hash(crypto.randomUUID(), 12);

    const org = await prisma.organization.create({
      data: { name: "Test Org (password-reset check)" },
    });
    const user = await prisma.user.create({
      data: {
        email: TEST_USER_EMAIL,
        name: "Test User",
        passwordHash,
        role: "ADMIN",
        organizationId: org.id,
      },
    });

    console.log(`Created Organization ${org.id} and User ${user.id} (${TEST_USER_EMAIL}).`);
    console.log("\nNext: on the real site, use the login page's 'Forgot password' link with");
    console.log(`  ${TEST_USER_EMAIL}`);
    console.log("and check the inbox that address delivers to.");
  }
} finally {
  await prisma.$disconnect();
}
