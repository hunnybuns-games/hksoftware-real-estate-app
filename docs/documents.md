# The document vault

Somewhere to drop every file a landlord already has — signed leases, W-9s,
insurance certificates, inspection reports, receipts, ID scans — and have each
one filed against the property, unit, tenant or lease it belongs to.

This is the *storage and filing* half of data ingest. Turning a spreadsheet
into real Property/Unit/Tenant/Lease/Payment rows is a separate, harder
feature that does not exist yet; see "What this deliberately is not" below.

## The shape of it

```
drop files  ->  identify by bytes  ->  guess a filing  ->  human corrects  ->  filed
              (file-signature.ts)   (document-filing.ts)   (/app/documents)
```

Deliberately the same shape as the CSV importer in `src/actions/import.ts`:
upload, see what the app made of it, correct it, done. Nothing about a
document is presented as final, because the guess is filename-only and will
sometimes be wrong.

One structural difference from the importer is worth knowing. An import batch
parks raw CSV in a `DRAFT` row and creates nothing until confirmed, because a
half-imported statement would double-count money. A document carries no such
hazard: the file is worth keeping the moment it lands, filed or not. So rows
are created immediately, and **unfiled is a real, visible state** rather than
a pending one — the "Needs filing" list at the top of `/app/documents`.

## Where the bytes live

`src/lib/document-storage.ts`, one interface with two implementations — the
same split, for the same reason, that `src/lib/db.ts` makes:

| Where | Backend |
|---|---|
| Production (`USE_D1=true`, on Workers) | the `DOCUMENTS` R2 bucket |
| `next dev`, tests, scripts | `.local-documents/` on disk (gitignored) |

The local half exists because `next dev` runs in plain Node with no Workers
runtime and therefore no bindings. Without it the feature would be
undevelopable outside a deploy.

**R2 rather than a `Bytes` column**, unlike `MaintenancePhoto` and
`ListingPhoto` which predate this binding. Those hold photos, capped at 4 MB
and rarely near it. This holds scanned leases — tens of megabytes each,
hundreds per landlord — and D1 has a hard per-database size ceiling that such
a pile would consume outright. Moving the two photo tables here is the natural
follow-up; `docs/ROADMAP.md` Phase 4 already tracks it.

Object keys are `<organizationId>/<random>`. The org prefix makes "everything
belonging to this org" one R2 list operation; the random suffix means a key
can never be derived from a filename. Neither is an access control — see
below.

### Setup

R2 must be enabled on the Cloudflare account (dashboard → R2 → Enable; the
free tier covers 10 GB) and the bucket created:

```sh
npx wrangler r2 bucket create comfylease-documents
```

The binding is already declared in `wrangler.jsonc`. Without the bucket, the
vault throws on upload and everything else in the app keeps working — the
same "optional integration, never crash a page" rule Stripe and Plaid follow.

## Identifying a file

`src/lib/file-signature.ts`. The browser-declared `file.type` is
attacker-controlled, so what gets stored and served is decided by the leading
bytes. Three tiers, in order of trustworthiness:

1. **Unambiguous magic bytes** — PDF, images (delegated to the existing
   `detectImageType`), RTF, legacy OLE. Trusted outright.
2. **Container formats needing a second look** — DOCX and XLSX are both ZIP
   archives with identical magic, told apart by scanning a bounded prefix for
   `word/` or `xl/` entry names.
3. **Formats with no signature at all** — CSV, plain text. Confirmed by
   checking the bytes decode as UTF-8 with no NUL byte, then narrowed by
   extension. This is the *only* tier where the filename gets any say.

Two safety properties fall out of this and are pinned by tests:

- An unrecognised file is **kept**, not rejected — it just becomes
  `application/octet-stream` and downloads rather than rendering.
- Anything textual that is not CSV/TSV is served as `text/plain`. An uploaded
  `.html` or `.svg` rendered inline would execute script on this origin;
  downgrading defuses that without refusing the file.

## Guessing where it goes

`src/lib/document-filing.ts`. Weighted keyword scoring over the filename for
the category, and the existing `suggestLeaseMatch` (shared with bank-statement
import, so the two can never drift) for which lease.

Multi-word phrases outscore single words, because they are far less likely to
appear by accident: "certificate of insurance" is decisive where a bare
"policy" could be anything. **A tie loses** — `lease application.pdf` reads
both ways and is left as `OTHER` rather than guessed at, exactly as an
ambiguous bank row is left unmatched.

If no single lease is identifiable but a property name appears, it files at
the property. Property insurance and tax bills belong at that level anyway.

Filenames are the only signal. Reading *inside* the file — OCR on a scan,
parsing a PDF text layer — would be far stronger and is deliberately not
attempted: it needs a document-AI dependency and a per-page cost model.
Nothing about the module's interface has to change to add it later as a
second opinion.

## Reading a document back

`/api/documents/[documentId]`, authorized on every request — the same rule
`/api/photos` follows. An unguessable URL is not an access control.

**Staff and owners only. Tenants get 404, even for a document filed against
their own lease.** The vault is a back-office pile: one tenant folder can hold
their screening report, an eviction notice drafted but never served, or a scan
that happens to show a co-applicant's ID. Exposing it by default and carving
out exceptions would be the wrong way round. A tenant-visible subset (their
signed lease, their receipts) is worth building deliberately, as its own
feature with its own opt-in, rather than falling out of this route by
accident.

Owners see only documents on properties they are linked to; a document with no
property — an unfiled drop, or an org-level tax form — is not theirs to read.

The content type is **re-derived from the bytes on every read**, not taken
from the stored column. A row edited by any future code path must not be able
to turn a stored blob into an inline `text/html` response.

## Where it shows up

- `/app/documents` — the whole vault. Needs-filing list first (it is the only
  part that needs a human), then everything filed, with type filter and search.
- Lease, property and tenant detail pages — a `DocumentsCard` listing what
  belongs to that record, with a drop zone pinned to it. This is the half that
  makes filing worth doing; without it the vault is a silo.

A drop zone that is pinned to a record skips the guess entirely for the
target — explicit context beats a heuristic — but still guesses the category.

## What this deliberately is not

- **Not a data importer.** A dropped `rent roll.xlsx` is stored and categorised
  as a `STATEMENT`. It does not create Property, Unit, Tenant or Lease rows.
  That is the other half of "make my history compatible", and it is a
  substantially harder feature: cross-sheet foreign-key resolution, dedup
  against existing records, a dry-run preview, and an XLSX parser this project
  does not currently depend on. `file-signature.ts` already classifies
  spreadsheets as their own `family` so that flow can claim them later without
  re-plumbing anything.
- **No text extraction or OCR.** See "Guessing where it goes".
- **No versioning.** Re-uploading a corrected lease creates a second document;
  it does not supersede the first. Duplicate *bytes* are detected and flagged,
  never blocked — one certificate of insurance legitimately covers two
  properties.
- **No virus scanning.** Files are stored as received and only ever served
  back to authenticated staff of the same organization, with content types
  constrained as described above. Worth revisiting if the vault is ever opened
  to tenant uploads.

## Testing

```sh
npx vitest run src/lib/__tests__/file-signature.test.ts
npx vitest run src/lib/__tests__/document-filing.test.ts

npm run db:seed:landlord10   # the e2e suite asserts against this dataset
npm run e2e:documents
```

The e2e suite drops a mixed batch (lease PDF, inspection PDF, insurance cert,
an unidentifiable scan, a CSV), checks each landed where the heuristics claim,
corrects one by hand, and confirms the download route serves the right bytes
with the right disposition — plus that a tenant and a signed-out visitor both
get 404. It mutates real rows, so re-seed before re-running.
