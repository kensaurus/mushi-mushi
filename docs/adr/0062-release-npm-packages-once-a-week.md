# 0062. Release the npm packages once a week

Status: Proposed (for the owner) Date: 2026-11-14

Related: `docs/DEPLOYMENT.md` §1.1, `.github/workflows/release.yml`
(unchanged by this ADR), ADR [0044](0044-release-trains-batch-approved-fixes.md)
(the same batching idea for the apps' fix PRs), ADR
[0060](0060-one-package-for-users.md) (one package for users), the owner's
CI-cost rule "release in big batches" (2026-10-01).

## Context

Every merged Changesets version PR publishes. In practice the version PR was
merged whenever a batch of fixes landed, often several times a day. From
2026-10-15 to 2026-11-13 (30 days, `npm view <pkg> time`):

| Package | Publishes |
| --- | --- |
| `@mushi-mushi/cli` | 26, on 16 different days, up to 4 in one day |
| `@mushi-mushi/mcp` | 19 |
| `mushi-mushi` | 13 |
| `@mushi-mushi/core`, `@mushi-mushi/web` | 10 each |
| `@mushi-mushi/react` | 5 |

What that costs:

- **Download counts stop meaning anything.** Each new version is fetched by
  registry mirrors, security scanners and our own CI, so weekly downloads
  rise with the publish rate, not with users. The growth audit of
  2026-11-14 could not use npm downloads as a signal for that reason.
- **The registries see churn.** Each `@mushi-mushi/mcp` release republishes
  `server.json` to the official MCP registry, and the directories that index
  from it (Glama, PulseMCP and others) re-index. Four versions in a day reads
  as an unstable server.
- **Users get nagged.** `mushi upgrade`, the console's SDK freshness chips
  and the "Create Upgrade PR" button all flag a new version. A host app that
  follows them opens an upgrade PR several times a week.
- **Each release runs the whole publish job** (build, provenance, smoke
  test, registry sync) and a version-PR CI run on the shared runner.

## Decision (proposed)

1. **One release a week.** Changesets keep landing with each feature PR, as
   now. The "chore: version packages" PR collects them all week and is
   merged once, on a fixed release day. The proposed day is Tuesday, so a
   bad release has the rest of the working week to be fixed. `release.yml`
   does not change: it publishes when the version PR merges, as it does now.
2. **An out-of-band patch release only for:**
   - a security fix;
   - a published version that breaks installs or setup (`npx mushi-mushi`,
     `mushi init`, the MCP server failing to start);
   - a widget or SDK bug that stops reports from being sent or crashes the
     host app.

   The version PR's body says which of these applies. Anything else waits for
   release day.
3. **Target:** at most 5 publishes of any one package in 30 days, outside the
   exceptions. Check it with `npm view @mushi-mushi/cli time`.

## Rejected

- **Publishing on every merge (the status quo).** It produces the numbers
  above.
- **A scheduled workflow that dispatches the release.** It changes CI, and
  merging the version PR stays a human step, as the version-PR CI and the
  bot-trigger quirks in DEPLOYMENT.md §1.1 already need one.
- **Monthly releases.** Fixes users report would wait up to a month. Weekly
  keeps the report-to-fix loop short enough to be the product's promise.
- **A `next` dist-tag for every merge.** It is useful later, but it doubles
  the publish count now, which is the problem being fixed.

## Consequences

- A non-urgent fix reaches npm up to a week after it merges. The changelog
  for each release is larger and easier to read.
- The MCP registry entry, the SDK version matrix and the docs version pins
  move once a week.
- If the owner accepts this, the status line above changes to Accepted with
  the owner's name and date, and DEPLOYMENT.md §1.1's "Release cadence" note
  loses its "proposed" label.
