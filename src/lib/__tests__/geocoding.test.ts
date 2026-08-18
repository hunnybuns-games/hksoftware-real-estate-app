import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildForwardGeocodeUrl,
  mapboxEnabled,
  parseMapboxFeature,
  suggestionLabel,
  type MapboxFeature,
} from "@/lib/geocoding";

const ORIGINAL_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

afterEach(() => {
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN = ORIGINAL_TOKEN;
});

describe("mapboxEnabled", () => {
  it("is false when the token is unset", () => {
    delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    expect(mapboxEnabled()).toBe(false);
  });

  it("is false for a blank/whitespace token", () => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "   ";
    expect(mapboxEnabled()).toBe(false);
  });

  it("is true once a token is set", () => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.fake";
    expect(mapboxEnabled()).toBe(true);
  });
});

describe("buildForwardGeocodeUrl", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.fake-token";
  });

  it("returns null when no token is configured", () => {
    delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    expect(buildForwardGeocodeUrl("123 Main")).toBeNull();
  });

  it("hits the v6 forward endpoint with the query and token", () => {
    const url = buildForwardGeocodeUrl("123 Main St");
    expect(url).toContain("https://api.mapbox.com/search/geocode/v6/forward?");
    expect(url).toContain("q=123+Main+St");
    expect(url).toContain("access_token=pk.fake-token");
  });

  it("restricts to US street addresses with autocomplete on", () => {
    const url = buildForwardGeocodeUrl("1 Infinite Loop");
    expect(url).toContain("autocomplete=true");
    expect(url).toContain("types=address");
    expect(url).toContain("country=us");
  });
});

// Shape per Mapbox's documented Geocoding v6 response.
const fullFeature: MapboxFeature = {
  properties: {
    full_address: "123 Main Street, Springfield, Illinois 62704, United States",
    name: "123 Main Street",
    context: {
      address: { name: "123 Main Street", address_number: "123", street_name: "Main Street" },
      street: { name: "Main Street" },
      place: { name: "Springfield" },
      region: { name: "Illinois", region_code: "IL" },
      postcode: { name: "62704" },
    },
  },
};

describe("parseMapboxFeature", () => {
  it("extracts all four fields from a full response", () => {
    expect(parseMapboxFeature(fullFeature)).toEqual({
      addressLine1: "123 Main Street",
      city: "Springfield",
      state: "IL",
      postalCode: "62704",
    });
  });

  it("builds addressLine1 from number+street when context.address.name is missing", () => {
    const feature: MapboxFeature = {
      properties: {
        context: {
          address: { address_number: "45", street_name: "Oak Ave" },
          place: { name: "Portland" },
          region: { region_code: "OR" },
          postcode: { name: "97205" },
        },
      },
    };
    expect(parseMapboxFeature(feature).addressLine1).toBe("45 Oak Ave");
  });

  it("falls back to full_address's first segment when context.address is entirely missing", () => {
    const feature: MapboxFeature = {
      properties: {
        full_address: "789 New Construction Way, Austin, Texas, United States",
        context: { place: { name: "Austin" }, region: { region_code: "TX" } },
      },
    };
    expect(parseMapboxFeature(feature).addressLine1).toBe("789 New Construction Way");
  });

  it("leaves postalCode blank rather than erroring when a new address has none yet", () => {
    const feature: MapboxFeature = {
      properties: {
        context: {
          address: { name: "1 New Build Ct" },
          place: { name: "Austin" },
          region: { region_code: "TX" },
        },
      },
    };
    expect(parseMapboxFeature(feature).postalCode).toBe("");
  });

  it("returns all-blank fields for a feature with no properties at all", () => {
    expect(parseMapboxFeature({})).toEqual({
      addressLine1: "",
      city: "",
      state: "",
      postalCode: "",
    });
  });
});

describe("suggestionLabel", () => {
  it("prefers the full formatted address", () => {
    expect(suggestionLabel(fullFeature)).toBe(
      "123 Main Street, Springfield, Illinois 62704, United States",
    );
  });

  it("falls back to name when full_address is missing", () => {
    expect(suggestionLabel({ properties: { name: "123 Main Street" } })).toBe("123 Main Street");
  });

  it("is an empty string for a feature with nothing usable", () => {
    expect(suggestionLabel({})).toBe("");
  });
});
