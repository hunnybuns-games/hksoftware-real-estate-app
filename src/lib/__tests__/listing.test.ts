import { describe, expect, it } from "vitest";
import {
  SYNDICATION_PLATFORMS,
  buildListingExportText,
  listingStatusLabel,
  listingStatusTone,
  syndicationPlatformLabel,
  syndicationPlatformManualUrl,
  syndicationStatusLabel,
  syndicationStatusTone,
  type ListingForExport,
} from "@/lib/listing";
import { utcDate } from "@/lib/dates";

const listing: ListingForExport = {
  title: "Sunny 2BR near downtown",
  description: "A bright, freshly painted two-bedroom with great natural light.",
  amenities: "In-unit laundry, Pet friendly, Off-street parking",
  askingRentCents: 185000,
  availableDate: utcDate(2026, 9, 1),
  unit: {
    label: "2B",
    bedrooms: 2,
    bathrooms: 1,
    sqft: 850,
    property: {
      name: "Maple Court",
      addressLine1: "123 Maple St",
      addressLine2: null,
      city: "Springfield",
      state: "IL",
      postalCode: "62704",
    },
  },
};

describe("listing status display", () => {
  it("labels and tones every status", () => {
    expect(listingStatusLabel("DRAFT")).toBe("Draft");
    expect(listingStatusTone("ACTIVE")).toBe("green");
    expect(listingStatusLabel("ARCHIVED")).toBe("Archived");
  });
});

describe("syndication status display", () => {
  it("labels and tones every status", () => {
    expect(syndicationStatusLabel("NOT_POSTED")).toBe("Not posted");
    expect(syndicationStatusTone("POSTED")).toBe("green");
    expect(syndicationStatusTone("NEEDS_REFRESH")).toBe("amber");
  });
});

describe("syndication platforms", () => {
  it("has a label and a manual-post URL for every platform in the catalog", () => {
    for (const platform of SYNDICATION_PLATFORMS) {
      expect(syndicationPlatformLabel(platform).length).toBeGreaterThan(0);
      expect(syndicationPlatformManualUrl(platform)).toMatch(/^https:\/\//);
    }
  });

  it("lists exactly the four platforms this app tracks", () => {
    expect(SYNDICATION_PLATFORMS.sort()).toEqual(
      ["APARTMENTS_COM", "REALTOR_COM", "ZILLOW", "ZUMPER"].sort(),
    );
  });
});

describe("buildListingExportText", () => {
  it("includes the title, address, price, beds/bath, and description", () => {
    const text = buildListingExportText(listing);
    expect(text).toContain("Sunny 2BR near downtown");
    expect(text).toContain("123 Maple St, Springfield, IL 62704");
    expect(text).toContain("Maple Court — Unit 2B");
    expect(text).toContain("$1,850.00/month");
    expect(text).toContain("2 bed / 1 bath · 850 sqft");
    expect(text).toContain("Available: Sep 1, 2026");
    expect(text).toContain("A bright, freshly painted two-bedroom");
  });

  it("lists each amenity on its own line", () => {
    const text = buildListingExportText(listing);
    expect(text).toContain("- In-unit laundry");
    expect(text).toContain("- Pet friendly");
    expect(text).toContain("- Off-street parking");
  });

  it("omits the amenities section entirely when there are none", () => {
    const text = buildListingExportText({ ...listing, amenities: null });
    expect(text).not.toContain("Amenities:");
  });

  it("says 'Now' instead of a date when nothing is available yet is set", () => {
    const text = buildListingExportText({ ...listing, availableDate: null });
    expect(text).toContain("Available: Now");
  });

  it("omits sqft when not on file", () => {
    const text = buildListingExportText({ ...listing, unit: { ...listing.unit, sqft: null } });
    expect(text).toContain("2 bed / 1 bath");
    expect(text).not.toContain("sqft");
  });
});
