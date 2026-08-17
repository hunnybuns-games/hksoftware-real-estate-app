"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { assertAdmin } from "@/lib/rbac";
import { type ActionState, actionOk, optionalText, parseForm, runAction } from "@/lib/forms";
import { encryptToken } from "@/lib/token-encryption";
import type { SyndicationPlatform } from "@prisma/client";

/**
 * Nothing reads apiKeyEncrypted yet — see the model comment on
 * ListingPlatformConnection and docs/listings.md. This action exists purely
 * so staff have somewhere to record a feed ID/API key once one of these
 * platforms actually approves this organization as a partner, without that
 * being a schema change when a real push feature ships later.
 */
const connectionSchema = z.object({
  accountLabel: optionalText(200),
  // The settings form never shows the decrypted key back, so a blank
  // submission means "nothing typed", not "clear it" — that's what the
  // separate checkbox below is for. Otherwise saving an unrelated field
  // (accountLabel, notes) would silently wipe a key that was never touched.
  apiKey: optionalText(500),
  clearApiKey: z
    .string()
    .optional()
    .transform((v) => v === "on" || v === "true"),
  notes: optionalText(1000),
});

export async function updateListingPlatformConnectionAction(
  platform: SyndicationPlatform,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const ctx = await assertAdmin();
    const parsed = parseForm(connectionSchema, formData);
    if (!parsed.ok) return parsed.state;

    const apiKeyEncrypted = parsed.data.apiKey ? await encryptToken(parsed.data.apiKey) : null;
    // Leave the stored key alone unless the caller typed a new one or
    // explicitly asked to clear it.
    const apiKeyChange = parsed.data.clearApiKey
      ? { apiKeyEncrypted: null }
      : parsed.data.apiKey
        ? { apiKeyEncrypted }
        : {};

    await db.listingPlatformConnection.upsert({
      where: { organizationId_platform: { organizationId: ctx.organizationId, platform } },
      create: {
        organizationId: ctx.organizationId,
        platform,
        accountLabel: parsed.data.accountLabel ?? null,
        apiKeyEncrypted: parsed.data.apiKey ? apiKeyEncrypted : null,
        notes: parsed.data.notes ?? null,
      },
      update: {
        accountLabel: parsed.data.accountLabel ?? null,
        notes: parsed.data.notes ?? null,
        ...apiKeyChange,
      },
    });

    revalidatePath("/app/settings/listing-syndication");
    return actionOk("Saved.");
  });
}
