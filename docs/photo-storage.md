# Photo storage

Maintenance and listing photos live in R2, in the same bucket and behind the
same interface as the document vault. This is the move `docs/ROADMAP.md`
Phase 4 tracked as "move maintenance photos off D1."

## Why

D1 has a hard per-database size ceiling, and photo blobs were sitting inside
it. At 4 MB a photo, 5 per maintenance request and 12 per listing, a few
hundred units is enough to make the database itself the constraint — and every
byte of it is replicated into every D1 read replica, which is a wasteful place
to keep something no query ever filters on.

`src/lib/object-storage.ts` already existed for the document vault, with an R2
implementation on Workers and a local-disk one everywhere else. Photos moving
here was always the plan (its own header comment said so); this is that,
plus generalising the names from `putDocument`/`getDocument`/`deleteDocument`
to `putObject`/`getObject`/`deleteObject` now that documents aren't the only
caller.

## The two-column window

Both `MaintenancePhoto` and `ListingPhoto` carry:

- `storageKey String? @unique` — the R2 object key. What new uploads write.
- `data Bytes?` — the old inline column. Nullable now, kept for rows written
  before the move.

Exactly one is set on any given row, and `photoBytes()` in `src/lib/photos.ts`
is the single place that decides which to read — **storageKey wins**. Both
serving routes go through it rather than restating the rule.

Uploads only ever write `storageKey`. `readPhotos()` validates every file in
the batch *before* storing any of them, so rejecting the fifth photo can't
leave the first four as objects nothing references — nothing would ever clean
those up, since the rows that would have pointed at them are never created.

## Backfilling

`GET /api/cron/photo-backfill`, bearer-authed with `CRON_SECRET` like the
other cron routes:

```sh
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://comfylease.com/api/cron/photo-backfill
```

Call it until the response reports `"done": true`. It moves 25 rows per table
per run, and each response carries `moved`, `failed`, and `remaining` for both
tables so you can see progress without querying anything.

It's an endpoint rather than a script because the source (D1) and the
destination (R2) only both exist as bindings inside a running Worker. A plain
Node script can reach production D1 through the Prisma D1 adapter — that's
what `scripts/d1-*.mjs` do — but reaching R2 from outside a Worker means
provisioning S3-compatible credentials: a new long-lived secret to create,
store, and eventually rotate, for a job that runs a handful of times and is
then finished.

Deliberately **not** on a schedule (note its absence from `wrangler.jsonc`'s
`crons`). It's a migration, not an ongoing job. It stays in the tree afterwards
because restoring an old backup would need it again.

Safe to interrupt and safe to repeat: it only selects rows that still have
`data` and no `storageKey`, commits each row on its own, and writes the object
before clearing the column — so a crash mid-row costs disk space, never an
image.

## Dropping the `data` column

Not done, on purpose. Once `remaining` is 0 in production **and** you're
satisfied nothing needs rolling back, `data` can come out in its own
migration. Doing it in the same one would have meant a schema that can't
serve rows the backfill hasn't reached yet.

## Known loose end

Deleting a listing photo deletes its object (`deleteListingPhotoAction`). But
cascade deletes — removing a whole listing, or a maintenance request — drop
the rows without touching R2, orphaning those objects. That's the same
property the document vault has, and the same trade-off: orphaned bytes are
wasted space, an orphaned row is something a landlord can see and can't get
rid of. Worth a reaper eventually (list the bucket by `<organizationId>/`
prefix, delete keys no row references); not worth it at a few hundred photos.

## Testing

The listings e2e suite covers the real path — upload through the form, then
fetch the photo back through the authorized route:

```sh
npm run e2e:listings
```

Locally the bytes land in `.local-documents/` (gitignored), not R2.
