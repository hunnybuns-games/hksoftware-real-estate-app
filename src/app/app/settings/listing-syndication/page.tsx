import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/rbac";
import { updateListingPlatformConnectionAction } from "@/actions/listing-connections";
import { SYNDICATION_PLATFORMS, syndicationPlatformLabel, syndicationPlatformManualUrl } from "@/lib/listing";
import { Banner, Card } from "@/components/ui";
import { ListingConnectionForm } from "../_components/listing-connection-form";

export const metadata: Metadata = { title: "Listing syndication" };

export default async function ListingSyndicationSettingsPage() {
  const ctx = await requireStaff();
  const isAdmin = ctx.role === "ADMIN";

  const connections = await db.listingPlatformConnection.findMany({
    where: { organizationId: ctx.organizationId },
  });
  const byPlatform = new Map(connections.map((c) => [c.platform, c]));

  return (
    <div className="max-w-2xl space-y-6">
      <Banner tone="info" title="Nothing here posts automatically — yet">
        None of these platforms offer a self-serve API for software to push listings; each
        requires this organization to be approved as a listing-software partner directly with
        them. Use <strong>Listings</strong> to build a listing and copy it over by hand in the
        meantime. See <code className="rounded bg-white/60 px-1 dark:bg-white/10">docs/listings.md</code> for
        details. The fields below just give a key somewhere to live once one of these approvals
        comes through — nothing reads them today.
      </Banner>

      {SYNDICATION_PLATFORMS.map((platform) => {
        const connection = byPlatform.get(platform);
        return (
          <div key={platform} data-testid={`connection-${platform}`}>
            <Card
              title={syndicationPlatformLabel(platform)}
              actions={
                <a
                  href={syndicationPlatformManualUrl(platform)}
                  target="_blank"
                  rel="noreferrer"
                  className="link text-sm"
                >
                  Visit {syndicationPlatformLabel(platform)} ↗
                </a>
              }
            >
              <ListingConnectionForm
                action={updateListingPlatformConnectionAction.bind(null, platform)}
                defaults={{
                  accountLabel: connection?.accountLabel ?? "",
                  notes: connection?.notes ?? "",
                }}
                hasStoredKey={Boolean(connection?.apiKeyEncrypted)}
                readOnly={!isAdmin}
              />
            </Card>
          </div>
        );
      })}
    </div>
  );
}
