import { db } from "@/lib/db";
import { DEFAULT_TEMPLATE_BODY } from "@/lib/lease-document";

/**
 * One reusable base template per organization — the wording staff edit in
 * Settings is what every new lease document starts from (see
 * src/actions/lease-documents.ts). A generated document is a snapshot, so
 * editing this never changes a document that's already been created.
 *
 * Lives here rather than in src/actions/lease-templates.ts on purpose. Every
 * export from a "use server" module is registered as a callable Server Action
 * endpoint, and this takes an organizationId with no session check of its own
 * — its callers (a settings page and a Server Action) have already established
 * theirs. Keeping it out of the action file means it can't be invoked as one.
 * See the gotcha in docs/MAINTAINER.md §4; this exact class of mistake has
 * bitten this repo before.
 */
export async function ensureDefaultTemplate(organizationId: string) {
  const existing = await db.leaseTemplate.findFirst({
    where: { organizationId },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  return db.leaseTemplate.create({
    data: {
      organizationId,
      name: "Standard Residential Lease",
      body: DEFAULT_TEMPLATE_BODY,
    },
  });
}
