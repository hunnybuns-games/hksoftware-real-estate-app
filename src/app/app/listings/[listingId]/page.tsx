import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaff, staffOrganizationIdForMetadata } from "@/lib/rbac";
import {
  addListingPhotosAction,
  archiveListingAction,
  deleteListingPhotoAction,
  updateListingAction,
  updateListingSyndicationAction,
} from "@/actions/listings";
import { centsToInputValue } from "@/lib/money";
import { toDateInputValue } from "@/lib/dates";
import {
  SYNDICATION_PLATFORMS,
  buildListingExportText,
  syndicationPlatformLabel,
  syndicationPlatformManualUrl,
} from "@/lib/listing";
import { MAX_LISTING_PHOTOS } from "@/lib/constants";
import { Breadcrumbs, Card, ListingStatusBadge, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/action-button";
import { Disclosure } from "@/components/disclosure";
import { EditListingForm } from "../_components/edit-listing-form";
import { DeletePhotoButton } from "../_components/delete-photo-button";
import { SyndicationRow } from "../_components/syndication-row";
import { AddPhotosForm } from "../_components/add-photos-form";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ listingId: string }>;
}): Promise<Metadata> {
  const { listingId } = await params;
  const organizationId = await staffOrganizationIdForMetadata();
  if (!organizationId) return { title: "Listing" };
  const listing = await db.listing.findFirst({
    where: { id: listingId, organizationId },
    select: { title: true },
  });
  return { title: listing?.title ?? "Listing" };
}

export default async function ListingDetailPage({
  params,
}: {
  params: Promise<{ listingId: string }>;
}) {
  const ctx = await requireStaff();
  const { listingId } = await params;

  const listing = await db.listing.findFirst({
    where: { id: listingId, organizationId: ctx.organizationId },
    include: {
      unit: {
        select: {
          label: true,
          bedrooms: true,
          bathrooms: true,
          sqft: true,
          property: {
            select: {
              name: true,
              addressLine1: true,
              addressLine2: true,
              city: true,
              state: true,
              postalCode: true,
            },
          },
        },
      },
      photos: { orderBy: { createdAt: "asc" }, select: { id: true, filename: true } },
      syndications: true,
    },
  });
  if (!listing) notFound();

  const exportText = buildListingExportText(listing);
  const syndicationByPlatform = new Map(listing.syndications.map((s) => [s.platform, s]));

  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs
          items={[
            { label: "Listings", href: "/app/listings" },
            { label: listing.title },
          ]}
        />
        <PageHeader
          title={listing.title}
          subtitle={`${listing.unit.property.name} — Unit ${listing.unit.label}`}
          actions={
            <>
              <ListingStatusBadge status={listing.status} />
              {listing.status !== "ARCHIVED" ? (
                <ActionButton
                  action={archiveListingAction.bind(null, listing.id)}
                  label="Archive"
                  pendingLabel="Archiving…"
                  variant="secondary"
                />
              ) : null}
            </>
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card title="Syndication tracker" description="Where this listing has been posted, tracked by hand.">
            <div className="space-y-3">
              {SYNDICATION_PLATFORMS.map((platform) => {
                const row = syndicationByPlatform.get(platform);
                if (!row) return null;
                return (
                  <SyndicationRow
                    key={platform}
                    action={updateListingSyndicationAction.bind(null, row.id)}
                    platform={platform}
                    platformLabel={syndicationPlatformLabel(platform)}
                    manualPostUrl={syndicationPlatformManualUrl(platform)}
                    copyText={exportText}
                    status={row.status}
                    listingUrl={row.listingUrl ?? ""}
                  />
                );
              })}
            </div>
          </Card>

          <Card title="Photos" description={`${listing.photos.length} of ${MAX_LISTING_PHOTOS}`}>
            {listing.photos.length > 0 ? (
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {listing.photos.map((photo) => (
                  <div key={photo.id} className="relative overflow-hidden rounded-lg border border-slate-200">
                    {/* eslint-disable-next-line @next/next/no-img-element -- served from our own authenticated route, not something Next's image pipeline should try to optimize */}
                    <img
                      src={`/api/listing-photos/${photo.id}`}
                      alt={photo.filename}
                      className="aspect-square w-full object-cover"
                    />
                    <DeletePhotoButton action={deleteListingPhotoAction.bind(null, photo.id)} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="mb-4 text-sm text-slate-500">No photos yet.</p>
            )}
            {listing.photos.length < MAX_LISTING_PHOTOS ? (
              <Disclosure label="Add photos">
                <AddPhotosForm
                  action={addListingPhotosAction.bind(null, listing.id)}
                  maxCount={MAX_LISTING_PHOTOS - listing.photos.length}
                />
              </Disclosure>
            ) : null}
          </Card>

          <Card title="Listing text" description="What the Copy buttons above put on your clipboard.">
            <pre className="max-h-96 overflow-auto rounded-lg bg-slate-50 p-4 text-xs whitespace-pre-wrap text-slate-700">
              {exportText}
            </pre>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Listing details">
            <EditListingForm
              action={updateListingAction.bind(null, listing.id)}
              defaults={{
                title: listing.title,
                description: listing.description,
                amenities: listing.amenities ?? "",
                askingRentCents: centsToInputValue(listing.askingRentCents),
                availableDate: toDateInputValue(listing.availableDate),
                status: listing.status,
              }}
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
