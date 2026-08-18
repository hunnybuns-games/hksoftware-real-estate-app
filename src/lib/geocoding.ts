/**
 * Address autocomplete for the property form, via Mapbox's Geocoding API
 * (v6). Framework-free parsing logic lives here, same split as
 * insurance.ts/applications.ts — the fetch and UI live in
 * src/components/address-autocomplete-input.tsx.
 *
 * NEXT_PUBLIC_MAPBOX_TOKEN is a Mapbox *public* token (`pk.…`) — designed by
 * Mapbox to be used exactly this way, embedded in client-side JS, unlike a
 * secret API key. That's also why this is safe to inline at build time
 * rather than route through a server action.
 *
 * Cloudflare-specific gotcha: Next.js inlines `NEXT_PUBLIC_*` vars into the
 * client bundle at *build* time, not read at request time — so this must be
 * set wherever `npm run cf:build` actually runs (a Cloudflare Workers Builds
 * "build variable", not a `wrangler.jsonc` var, which is a runtime binding
 * the client bundle can't see). See docs/address-autocomplete.md.
 */

export function mapboxEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim());
}

/** US-only forward geocoding, restricted to street addresses — this app has no use for city/POI-level results. */
export function buildForwardGeocodeUrl(query: string): string | null {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim();
  if (!token) return null;

  const params = new URLSearchParams({
    q: query,
    access_token: token,
    autocomplete: "true",
    types: "address",
    country: "us",
    limit: "5",
  });
  return `https://api.mapbox.com/search/geocode/v6/forward?${params.toString()}`;
}

/**
 * The subset of a v6 GeoJSON feature this app reads. Deliberately narrow and
 * all-optional — an address API response is external input, and a field
 * Mapbox omits (unusual, but real: a new-construction address might have no
 * postcode yet) must degrade to "leave it blank," never throw.
 */
export type MapboxFeature = {
  properties?: {
    full_address?: string;
    name?: string;
    context?: {
      address?: { name?: string; address_number?: string; street_name?: string };
      street?: { name?: string };
      place?: { name?: string };
      region?: { name?: string; region_code?: string };
      postcode?: { name?: string };
    };
  };
};

export type ParsedAddress = {
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
};

/**
 * Pulls the four fields the property form actually has out of one feature.
 * Falls back from the structured `context.address` to the number+street
 * pieces to `full_address`'s first line, so a response missing one field
 * still fills in whatever it can rather than leaving everything blank.
 */
export function parseMapboxFeature(feature: MapboxFeature): ParsedAddress {
  const context = feature.properties?.context;

  const addressLine1 =
    context?.address?.name ??
    (context?.address?.address_number && context?.address?.street_name
      ? `${context.address.address_number} ${context.address.street_name}`
      : undefined) ??
    feature.properties?.name ??
    feature.properties?.full_address?.split(",")[0]?.trim() ??
    "";

  return {
    addressLine1,
    city: context?.place?.name ?? "",
    state: context?.region?.region_code ?? "",
    postalCode: context?.postcode?.name ?? "",
  };
}

/** Label shown in the suggestion dropdown — the full formatted address is more recognizable than any single field. */
export function suggestionLabel(feature: MapboxFeature): string {
  return feature.properties?.full_address ?? feature.properties?.name ?? "";
}
