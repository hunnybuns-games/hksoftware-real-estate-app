# Address autocomplete

Live suggestions on the property form's street-address field, via Mapbox's
Geocoding API. Covers why Mapbox, how it degrades, and one thing worth
verifying once you have a real account — this was built against Mapbox's
documented API shape, not confirmed against a live response.

## Why Mapbox

This only needed a provider that's genuinely self-serve — sign up, get a key,
done — unlike the Zillow-style partnership programs elsewhere in this app
(see docs/listings.md). Mapbox's free tier is 100,000 geocoding requests a
month with no credit card required to start: https://account.mapbox.com/auth/signup/.
Google Places has the more recognizable autocomplete UX, but requires a
Google Cloud billing account (a card on file) even to use the free monthly
credit, which is real friction for getting started today.

## How it works

`src/lib/geocoding.ts` holds the framework-free pieces — `mapboxEnabled()`,
the request URL builder, and `parseMapboxFeature()`, which turns one v6
GeoJSON feature into the four fields the property form has
(`addressLine1`/`city`/`state`/`postalCode`). All pure, all unit tested.

`src/components/address-autocomplete-input.tsx` is the client half: a plain
text input that debounces (250ms) into a `fetch()` against Mapbox's
`/search/geocode/v6/forward` endpoint, shows a dropdown of results, and hands
the parsed fields back to `PropertyForm` when one is picked. The form lifts
`addressLine1`/`city`/`state`/`postalCode` into controlled state for exactly
this — see property-form.tsx — but every one of those fields stays a normal
editable input. A suggestion pre-fills; it never locks.

`NEXT_PUBLIC_MAPBOX_TOKEN` is a Mapbox **public** token (`pk.…`) — Mapbox
designs these to be embedded in client-side JS, unlike a secret API key, so
inlining it into the browser bundle is the intended usage, not a leak.
`connect-src` in `src/middleware.ts`'s CSP allows `https://api.mapbox.com`
for exactly this fetch.

## Degrades cleanly with no token

`mapboxEnabled()` gates the lookup entirely. With no
`NEXT_PUBLIC_MAPBOX_TOKEN` set, the input never fetches and never shows a
dropdown — indistinguishable from a plain text field. A network hiccup or a
bad token behaves the same way: suggestions silently disappear, the field
keeps working. Nothing about entering a property address ever depends on
this succeeding.

## The Cloudflare build-time gotcha

Next.js inlines `NEXT_PUBLIC_*` variables into the client bundle at **build**
time — a request-time read, the way `wrangler.jsonc`'s `vars` work, can't see
it. Set `NEXT_PUBLIC_MAPBOX_TOKEN` as a **Workers Builds build variable** in
the Cloudflare dashboard (Settings → Builds), not in `wrangler.jsonc`.

## What's verified, and what isn't

The full mechanism — debounced fetch, dropdown, filling the sibling fields —
is verified end to end with a mocked response shaped like Mapbox's
documented v6 schema (`features[].properties.context.{address,place,region,postcode}`).
`parseMapboxFeature()`'s field-mapping is unit tested against that same
documented shape, with fallbacks for a feature missing a piece (a
new-construction address with no postcode yet, for instance).

What that doesn't cover: an actual response from a live Mapbox account. If
their schema has drifted from what's documented, or a field is named
slightly differently than expected, addresses would fall back to filling in
less than all four fields — never break, per the previous section, but worth
a real test once you've got a token: type a real address and confirm city/
state/ZIP land correctly, not just `addressLine1`.

One CI wrinkle this surfaced: CI sets `NEXT_PUBLIC_MAPBOX_TOKEN` so this
suite can run, but that token is live for the *whole* e2e job, not just this
suite — every other test that fills the property address field in passing
(`e2e:mvp`, `e2e:security`, `e2e:theme`) would otherwise fire a real,
unmocked request to Mapbox and race it against the rest of a fast form fill.
It doesn't break the field itself (still degrades to "no suggestions" on any
error), but it's slow and unreliable, and it did in fact fail a CI run this
way once. `e2e/_shared.mjs`'s `launchBrowser()` now stubs `api.mapbox.com`
with an empty result on every context by default; this suite overrides that
with its own page-level routes, which Playwright always prefers.
