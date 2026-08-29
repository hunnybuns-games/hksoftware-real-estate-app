# Environments and the deploy gate

How code gets from a commit to `comfylease.com`, what currently stands between
those two things (not much), and what to change before real tenant money is
moving through it.

## What the pipeline actually is today

One branch, one build target, one database:

- **`claude/property-management-mvp-gjlizb` is the repo's default branch** and
  also the working branch. `main` exists but is ~85 commits behind and is not
  what deploys.
- **Cloudflare Workers Builds deploys straight off a push to that branch**, with
  no gate in front of it. `.github/workflows/ci.yml` says this about itself:
  "Cloudflare Workers Builds deploys straight off a branch push with no gate in
  front of it, so this is the only thing standing between a broken commit and
  production." That's accurate, with one correction worth being precise about:
  CI *reports* pass/fail, it does not *block* the deploy. Cloudflare and GitHub
  Actions are watching the same push independently, and Cloudflare doesn't wait
  for Actions. A commit that fails CI still ships.
- **There is one D1 database and one R2 bucket.** `wrangler.jsonc` declares no
  `env` blocks, so there is no staging anything — no second database, no second
  bucket, no second set of rate limiters.
- **`.github/workflows/d1.yml` auto-applies migrations to the production
  database** when a push changes `migrations/`. It takes a backup first, which
  is the right instinct, but the trigger is still "someone pushed."

Net effect: `git push` is a production deploy, and a push that touches
`migrations/` is a production deploy *and* a schema change against the real
database. That's fine for an app with no customers. It stops being fine the day
someone's rent is in there.

## What to change, in order of value per unit of effort

### 1. Put a gate in front of production — high value, no new infrastructure

The whole fix is branch topology plus one Cloudflare setting:

1. Bring `main` up to date with the current working branch (a merge, not a
   force-push — the history on both sides is real).
2. Point **Cloudflare Workers Builds at `main`** instead of the working branch
   (Cloudflare dashboard → Workers & Pages → the project → Settings → Builds →
   production branch).
3. Turn on **branch protection for `main`** (GitHub → Settings → Rules/Branches):
   require a pull request, and require the `CI` workflow's checks to pass before
   merge.
4. Keep day-to-day work on feature branches; merge to `main` when it's meant to
   ship.

After that, "CI is the only thing standing between a broken commit and
production" becomes true in the way the comment already assumes it is — a red
build blocks the merge, and nothing reaches `comfylease.com` that didn't pass.

Worth doing as one change, because steps 2 and 3 without step 1 would leave
production pinned to a branch that's ~85 commits stale.

### 2. Decide what guards migrations specifically — medium value

Branch protection means a migration lands only after CI passes, which catches
"this migration doesn't apply cleanly" and "the schema no longer matches
Prisma" (`npm run cf:migrations:check` already runs in CI). It does not catch
"this migration applies fine and destroys data that only exists in production."

Two options, not mutually exclusive:

- **Rehearse the restore.** `docs/ROADMAP.md` Phase 4 already tracks this and
  it's the cheaper of the two: prove the backup that `d1.yml` takes can actually
  be restored, once, against a throwaway database. An unrehearsed backup is a
  hope, not a rollback plan.
- **Make migration application manual.** Drop the `paths: migrations/**` push
  trigger from `d1.yml` and rely on its existing `workflow_dispatch` path, so a
  schema change against production is always a deliberate button press. Costs a
  step per schema change; removes a category of accident entirely.

### 3. A real staging environment — worth it later, not now

`wrangler.jsonc` would need an `env.staging` block duplicating the D1 database,
the R2 bucket, five rate limiters, and the email binding — plus a parallel set
of secrets, since Cloudflare secrets are per-environment and write-only.

That's a real ongoing maintenance cost (every new binding has to be added
twice, every secret rotated twice), and right now it buys little that step 1
doesn't: with no live customers, production *is* the staging environment, and
the actual risk being managed is "broken code ships automatically," which the
gate fixes.

Revisit when either becomes true:

- There is real customer data that a bad migration would destroy, and "restore
  from backup" is no longer an acceptable answer.
- More than one person is committing, so "don't merge that yet" stops being
  something one person can hold in their head.

## What I can do vs. what needs you

This is deliberately split, because most of it isn't code:

| Step | Who |
|---|---|
| Merge the working branch into `main` | Me, on request |
| Point Workers Builds at `main` | **You** — Cloudflare dashboard |
| Branch protection on `main` | **You** — GitHub repo settings |
| Drop `d1.yml`'s auto-apply trigger (if wanted) | Me, on request |
| Rehearse a backup restore | **You** — needs a throwaway D1 and dashboard access |
| Add `env.staging` to `wrangler.jsonc` | Me, when it's wanted |

The two dashboard steps are the load-bearing ones, and neither is something a
commit can do. Nothing in this file has been applied — changing where
production deploys from is not a decision to make on someone's behalf.
