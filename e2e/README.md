# End-to-end suites

Ten Playwright scripts that drive a real browser against a running dev server.
They're plain Node scripts rather than a Playwright test-runner project on
purpose — each one reads top-to-bottom as a description of the flow it checks,
which is what you want when one fails at 2am and you need to know what it was
actually doing.

## Running them

```
npm run db:migrate && npm run db:seed   # seeded demo data is a prerequisite
npm run dev                             # in another terminal
npm run e2e                             # or one at a time, see below
```

| Script | Covers | Checks |
|---|---|---|
| `npm run e2e:mvp` | auth, properties, units, tenants, leases, rent, Stripe simulation, maintenance | 48 |
| `npm run e2e:reconciliation` | HAP/subsidy splits, manual source-aware entry, the CSV import flow | 16 |
| `npm run e2e:reports` | rent roll, P&L, owner statements, every CSV export, owner scoping | 19 |
| `npm run e2e:security` | cross-org isolation, signup/login abuse, role boundaries, open redirect, session revocation, CSP | 26 |
| `npm run e2e:password-reset` | the reset flow: no account enumeration, single-use links, old password revoked | 14 |
| `npm run e2e:theme` | dark mode: OS default, explicit choice, persistence, and a colour audit of every surface | 33 |
| `npm run e2e:applications` | public application intake, staff review/approval, convert-to-lease | 17 |
| `npm run e2e:lease-signing` | lease builder + e-signature: generate, countersign & send, tenant review & sign | 17 |
| `npm run e2e:listings` | listing builder, photo upload, syndication tracker, copy-paste export, platform-connection settings | 21 |
| `npm run e2e:address-autocomplete` | property-form address autocomplete: suggestion fill, graceful degradation, CSP (Mapbox mocked, never really contacted) | 12 |

Each prints one line per check and exits non-zero if any failed.

## Prerequisites and gotchas

- **Seeded data is assumed.** The suites sign in as `admin@example.com` /
  `demo-password-123` and expect the demo portfolio `npm run db:seed` creates.
  They're not hermetic — they read and write the same local database your dev
  server is using.
- **`e2e:security` creates organizations and leaves them behind.** It signs up
  fresh orgs each run to test cross-org isolation, so the local database
  accumulates test orgs. Re-seed when that gets noisy.
- **First run needs a browser.** `npx playwright install chromium` once. Set
  `PLAYWRIGHT_EXECUTABLE_PATH` if you're somewhere that ships Chromium outside
  Playwright's cache (a CI image, some sandboxes).
- **Point them elsewhere with `E2E_BASE_URL`.** Defaults to
  `http://localhost:3000`. Check what `npm run dev` actually bound to — if
  something else holds port 3000, Next silently uses 3001 and every check fails
  in confusing ways.
- **Screenshots land in `e2e/.artifacts/`** (gitignored).

## What they don't cover

Stripe and Plaid are never really contacted — Stripe payments go through the
demo-mode simulation path, and there is no bank-feed coverage at all. See
`docs/MAINTAINER.md` §13 for the current state of that. Mapbox is mocked too
(`e2e:address-autocomplete`) — see docs/address-autocomplete.md for what that
does and doesn't prove.
