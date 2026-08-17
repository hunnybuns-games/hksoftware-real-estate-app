import type { ListingStatus, ListingSyndicationStatus, SyndicationPlatform } from "@prisma/client";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";

/**
 * Framework-free logic behind listings — status display and the copy-paste
 * export text — split out the same way applications.ts and insurance.ts keep
 * their domain logic testable without a database or a component tree.
 */

// Matches BadgeTone in src/components/ui.tsx — see ApplicationStatusTone for
// why this stays its own type rather than importing the UI-layer one here.
export type ListingStatusTone = "green" | "amber" | "blue" | "red" | "slate";

const STATUS_META: Record<ListingStatus, { label: string; tone: ListingStatusTone }> = {
  DRAFT: { label: "Draft", tone: "slate" },
  ACTIVE: { label: "Active", tone: "green" },
  ARCHIVED: { label: "Archived", tone: "slate" },
};

export function listingStatusLabel(status: ListingStatus): string {
  return STATUS_META[status].label;
}

export function listingStatusTone(status: ListingStatus): ListingStatusTone {
  return STATUS_META[status].tone;
}

const SYNDICATION_STATUS_META: Record<ListingSyndicationStatus, { label: string; tone: ListingStatusTone }> = {
  NOT_POSTED: { label: "Not posted", tone: "slate" },
  POSTED: { label: "Posted", tone: "green" },
  NEEDS_REFRESH: { label: "Needs refresh", tone: "amber" },
};

export function syndicationStatusLabel(status: ListingSyndicationStatus): string {
  return SYNDICATION_STATUS_META[status].label;
}

export function syndicationStatusTone(status: ListingSyndicationStatus): ListingStatusTone {
  return SYNDICATION_STATUS_META[status].tone;
}

/**
 * Display name and where staff would actually go to post a listing by hand
 * today. Deliberately the platform's own homepage/rental-manager entry
 * point, not a specific deep link this app can't verify stays valid — see
 * docs/listings.md for why there's nothing more automated than this yet.
 */
const PLATFORM_META: Record<SyndicationPlatform, { label: string; manualPostUrl: string }> = {
  ZILLOW: { label: "Zillow", manualPostUrl: "https://www.zillow.com/rental-manager/" },
  REALTOR_COM: { label: "Realtor.com", manualPostUrl: "https://www.realtor.com/" },
  ZUMPER: { label: "Zumper", manualPostUrl: "https://www.zumper.com/" },
  APARTMENTS_COM: { label: "Apartments.com", manualPostUrl: "https://www.apartments.com/" },
};

export function syndicationPlatformLabel(platform: SyndicationPlatform): string {
  return PLATFORM_META[platform].label;
}

export function syndicationPlatformManualUrl(platform: SyndicationPlatform): string {
  return PLATFORM_META[platform].manualPostUrl;
}

export const SYNDICATION_PLATFORMS: SyndicationPlatform[] = [
  "ZILLOW",
  "REALTOR_COM",
  "ZUMPER",
  "APARTMENTS_COM",
];

export type ListingForExport = {
  title: string;
  description: string;
  amenities: string | null;
  askingRentCents: number;
  availableDate: Date | null;
  unit: {
    label: string;
    bedrooms: number;
    bathrooms: number;
    sqft: number | null;
    property: {
      name: string;
      addressLine1: string;
      addressLine2: string | null;
      city: string;
      state: string;
      postalCode: string;
    };
  };
};

/**
 * A single well-formatted plain-text block, reused for every platform's
 * "Copy" button. Not tuned per platform (character limits, required fields)
 * — those specifics change without notice and this app has no way to verify
 * them, so one honest, complete block beats guessing at four different
 * formats. See docs/listings.md.
 */
export function buildListingExportText(listing: ListingForExport): string {
  const p = listing.unit.property;
  const addressLine = [p.addressLine1, p.addressLine2].filter(Boolean).join(", ");
  const amenities = (listing.amenities ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);

  const lines = [
    listing.title,
    "",
    `${addressLine}, ${p.city}, ${p.state} ${p.postalCode}`,
    `${p.name} — Unit ${listing.unit.label}`,
    "",
    `Rent: ${formatCents(listing.askingRentCents)}/month`,
    `${listing.unit.bedrooms} bed / ${listing.unit.bathrooms} bath${listing.unit.sqft ? ` · ${listing.unit.sqft.toLocaleString()} sqft` : ""}`,
    `Available: ${listing.availableDate ? formatDate(listing.availableDate) : "Now"}`,
    "",
    listing.description.trim(),
  ];

  if (amenities.length > 0) {
    lines.push("", "Amenities:", ...amenities.map((a) => `- ${a}`));
  }

  return lines.join("\n");
}
