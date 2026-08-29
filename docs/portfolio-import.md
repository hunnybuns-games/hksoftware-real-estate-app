# Importing an existing portfolio

The migration path for a landlord arriving with a rent roll. Upload a CSV,
confirm what each column means, review exactly what will be created, and get
real Property, Unit, Tenant and Lease records out the other end.

This is the *data* half of ingest. The *document* half — filing PDFs, W-9s and
inspection reports against those records — is `docs/documents.md`.

## Two importers, deliberately

| | `/app/import` (this) | `/app/payments/import` |
|---|---|---|
| Creates | Properties, units, tenants, leases | Payment rows |
| Answers | "who lives where, on what terms" | "what money arrived" |
| When | Once, at onboarding | Every month |

They have the same three-step shape — upload, map columns, confirm — because
they are the same problem. Run this one first: payments need leases to match
against.

## What it will not do

**It does not create charges or payments.** Billing history is
`generateRentCharges()`'s job (`src/lib/ledger.ts`), which already owns the
rules — one charge per calendar month from the lease start, capped so
onboarding a five-year-old lease does not post sixty charges. Duplicating that
here would give two answers to the same question.

So the onboarding sequence is:

1. **Import portfolio** — leases exist.
2. **Post rent charges** (Rent page) — they get billing history.
3. **Import statement** — the money that already came in gets matched.

**It does not read Excel.** An `.xlsx` upload is detected and refused with a
message telling you to save as CSV, rather than failing as "no header row
found". Reading XLSX means unzipping and parsing sheet XML — feasible without
a dependency (Workers has `DecompressionStream`) but not yet built.

## The rules

All in `src/lib/portfolio-import.ts`, all pure and unit-tested. Nothing there
touches the database; planning takes an explicit snapshot of what already
exists. Same split `reconciliation.ts` makes, and for the same reason: this is
the code that decides whether a landlord ends up with 40 leases or 80.

### Column detection

Guessed from header spellings seen across Innago/Buildium/AppFolio exports and
hand-kept spreadsheets. Two rules that matter more than the candidate lists:

- **One header can only fill one role.** Fields are resolved in decreasing
  order of how distinctive their headers are, so `tenantEmail` claims "Tenant
  Email" before the greedy `tenantName` — which contains "tenant" — can
  swallow it.
- **Short candidates match exactly, never loosely.** The two-letter
  abbreviations real exports use are substrings of half the language: left in
  the loose pass, `st` (state) claims **"Lease Start"** and `ba` (bathrooms)
  claims "Balance". Because a header can only be taken once, the field that
  genuinely wanted that column is then left unmapped. Four characters is the
  minimum for a substring match.

Whatever it guesses is shown as editable selects, and the preview re-renders
from the corrected mapping.

### Rows

- **Names** — `"Smith, John"` and `"John Smith"` are both understood; the
  comma is the tell. Extra parts collapse into the first name (`Maria del
  Carmen Ruiz` → first `Maria del Carmen`, last `Ruiz`) rather than being
  dropped, because losing part of someone's name is worse than an odd split.
- **Dates** — ISO, `M/D/YYYY` and `M/D/YY`.
- **Missing email** — a deterministic placeholder is generated rather than
  blocking the row. `Tenant.email` is required and unique per organization, so
  the row cannot simply be left blank, but refusing it outright would make the
  feature useless to any landlord whose spreadsheet predates collecting email
  addresses — which is most of them. The placeholder uses the `.invalid` TLD
  (reserved by RFC 2606, can never resolve), so it can never accidentally
  deliver mail to a real stranger; the failure mode is a logged bounce, not a
  message to the wrong person. Deterministic from property and unit, so
  re-importing matches the same tenant instead of creating a second one. The
  preview counts them and says so prominently.
- **Missing unit** — becomes `House`, for single-family rows.
- **Missing rent / lease start** — warned, not blocked; `$0` and today.
- **Missing street address** — the property name stands in, since
  `Property.addressLine1` is required. Flagged once on the preview rather than
  on every row.

### Blocking versus warning

A row is **blocked** only when importing it would be wrong, not merely
incomplete:

- no property name and no address;
- no tenant name;
- an unparseable email, rent or lease start date;
- a lease ending before it starts;
- **the unit already has an active lease** — importing would double-lease it,
  so the landlord has to decide whether the sheet or the app is right;
- **the same unit appears twice in the file** — the second occurrence loses.

Everything else is a warning: imported, with a note on the preview.

### Deduplication

Matched against existing records *and* within the batch itself — a rent roll
lists a 10-unit building on ten rows, and the property must be created once,
not ten times.

| Entity | Matched by |
|---|---|
| Property | name, case-insensitive |
| Unit | label within its property |
| Tenant | email address |

**Running the same file twice is a no-op.** The second run finds everything
already there, plans zero creations, and says so. A repeat upload of an
identical file reopens the existing batch rather than being refused — unlike
the payment importer, where a duplicate would double-count money.

## The preview is the safety mechanism

Everything on the review screen is recomputed from the stored CSV and the
batch's current mapping on every render — never cached, never taken from the
client. Each row shows a **New** or **Existing** badge per entity, so it is
obvious at a glance what will be added versus reused.

The confirm step **re-plans from scratch** against current data rather than
trusting what the preview was rendered from. Between the two steps another
admin may have created the very property this import was about to create, or
leased one of its units.

The per-row checkbox means **import this**, matching its column header. A
blocked row renders unticked and disabled, so it submits nothing and excludes
itself. (These were inverted during development — importable rows showed
unticked, so ticking the good rows would have skipped every one of them. The
e2e suite now asserts the tick state directly.)

## Testing

```sh
npx vitest run src/lib/__tests__/portfolio-import.test.ts

npm run db:seed:landlord10   # the e2e suite asserts against this dataset
npm run e2e:portfolio-import
```

The e2e suite uploads a rent roll that mixes clean rows with the messy
realities — a comma-formatted name, US slash dates, a missing email, a unit
that is already leased in the seed, a row duplicated within the file, an
unreadable date, and a good row that gets unticked by hand — then checks the
preview classified each correctly and that exactly the right records exist
afterwards. It creates a second property, so re-seed before re-running.
