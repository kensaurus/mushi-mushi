# 0036. Licensing posture: open core, protected brand and tuning

Status: Proposed Date: 2026-10-22

Related: [`LICENSE`](../../LICENSE), [`TRADEMARK.md`](../../TRADEMARK.md),
[`COMMERCIAL-LICENSE.md`](../../COMMERCIAL-LICENSE.md), [`CLA.md`](../../CLA.md),
[`NOTICE`](../../NOTICE), `packages/server/ee/LICENSE`, the June 2026 post
[`apps/docs/content/blog/agplv3-relicense.mdx`](../../apps/docs/content/blog/agplv3-relicense.mdx),
[`VISION.md`](../../VISION.md) (self-host is free and complete), ADR
[0028](0028-spend-down-expiring-agent-credits.md) (spend-down thresholds),
`_shared/prompt-ab.ts` and `_shared/judge-rubric.ts` (prompt and rubric
overrides), `scripts/check-license-consistency.mjs`,
`scripts/check-license-headers.mjs`, `.github/workflows/cla.yml`.

## Context

The owner asked how to protect the code while keeping reach, credibility,
security and GTM: "do the best practice based on research while maximizing
user reach, credibility, security and GTM purpose". Licensing has never had
an ADR. A review on 2026-10-22 found:

- The server moved from BSL 1.1 to AGPL-3.0-only in June 2026, in public, with
  a blog post calling the BSL period a credibility mistake. `TRADEMARK.md`
  still said BSL 1.1 in four places and quoted a retired tagline.
- The console (`apps/admin`) was MIT. It is the product a user sees. Under
  MIT anyone can rebrand it and ship it closed, next to the AGPL server.
- The logo and mark files in `packages/brand` were published under MIT, so the
  copyright license on the images contradicted the trademark policy.
- Two copyright holder strings were in use ("Kenji Sakuramoto" and
  "Kenji Sakuramoto / Kensaurus 合同会社"), and two packages said "Mushi Mushi".
- The AGPL `LICENSE` files said "version 3 … or (at your option) any later
  version" while their SPDX line and the root `LICENSE` said AGPL-3.0-only.
  The full AGPL text was not in the repository.
- `packages/marketing-ui` declared `SEE LICENSE IN LICENSE` with no LICENSE
  file; `apps/testers` had no license field.
- There is no CLA or DCO, yet `COMMERCIAL-LICENSE.md` offers the AGPL code
  under a second license, which only the holder of every contribution's
  rights can do. All 416 commits so far are by the owner, bots and coding
  agents working for the owner, so introducing a CLA now has no back catalog.
- The marks are not registered anywhere.

What other projects did: Redis left BSD for RSALv2/SSPL in March 2024, lost
contributors to the Valkey fork, and added AGPLv3 back with Redis 8 in May
2025. Elastic added AGPL in August 2024 after its SSPL years. HashiCorp's BSL
switch in 2023 produced the OpenTofu fork. Sentry (2023) and GitButler (2024)
chose the Functional Source License: source-available, no competing use, each
release converts to Apache-2.0 or MIT after two years. Grafana and Mattermost
run AGPL plus a commercial license, which is the model Mushi already uses.

## Decision

1. **The server stays AGPL-3.0-only**, with the commercial license beside it
   (`packages/server`, `packages/agents`, `packages/verify`). The license text
   says "version 3 only", matching its SPDX identifier, and the verbatim AGPL
   text ships at `LICENSES/AGPL-3.0-only.txt`.
2. **SDKs, CLI, MCP server, plugins and adapters stay MIT.** They run inside
   the user's app and editor; copyleft there would cost reach for nothing.
3. **The console (`apps/admin`) and the tester portal (`apps/testers`) are
   AGPL-3.0-only from this change on**, and covered by the commercial
   license. Versions up to and including commit `862e53ff` (2026-10-22) were
   MIT; anyone who has them keeps those rights. AGPL does not stop a fork, but
   a modified console offered as a service must publish its source, which
   removes the "rebrand and ship closed" path.
4. **Brand assets are all rights reserved** and usable only as
   `TRADEMARK.md` allows: the logo and bug mark files, favicons and app icons,
   the mascot art and the social cards that show them. `packages/brand` keeps
   its code, CSS and tokens MIT; its `LICENSE` splits the two parts and its
   manifest says `SEE LICENSE IN LICENSE`. Copies of those files made before
   this change were MIT for copyright purposes; the marks themselves were never
   licensed. `TRADEMARK.md` says how others may use the logo (unmodified, to
   refer or link to Mushi, never as their own identity).
5. **Tuning is hosted configuration from now on.** The repository keeps
   working baseline prompts, the default judge rubric, eval fixtures needed by
   tests, and the spend-down defaults published in ADR 0028, so a self-hosted
   stack is complete and gets the same features. Prompts tuned on production
   traffic, production eval sets, judge rubric weights and later spend-down
   tuning live in the hosted database as data (`prompt_versions` rows,
   `judge_rubric`, runtime config), not in the repository. The public claim
   changes from "provably the same code" to "**the same code; the hosted
   service carries its own tuning data**", and the docs say so in those words.
   This narrows nothing that exists today; it describes where future tuning
   goes. AGPL covers code, not the operator's data, so this needs no license
   change.
6. **Outside contributions come in under a CLA** (`CLA.md`, adapted from the
   Apache Individual CLA v2.2), signed once by pull request comment through
   `contributor-assistant/github-action` pinned by SHA; signatures live in
   `signatures/version1/cla.json` on the unprotected `cla-signatures` branch.
   Bots, the owner and pull requests from branches of this repository skip it.
   The CLA promises that a contribution stays available under MIT or an
   OSI-approved license while it is distributed (except Enterprise Edition
   contributions). It is a draft until counsel reviews it, and no outside pull
   request is merged before then.
7. **Canary strings are evidence, not prevention.** The owner may place
   natural-looking unique phrases in baseline prompts and in hosted prompt
   rows to show later that a product copied them. Their list is kept
   privately and never written into the repository. A canary in public AGPL
   code proves derivation only; copying is allowed, so it matters when a
   modified server is run closed or when hosted tuning leaks.
8. **One copyright holder string**: "Kenji Sakuramoto / Kensaurus 合同会社",
   the form `packages/server/ee/LICENSE` already used, in every `LICENSE`,
   `NOTICE`, source header and in `TRADEMARK.md` as the trademark owner. The
   owner can change it; the consistency check then names every file to edit.
9. **Trademark registration is an owner and lawyer action**, not code: file
   with the Japan Patent Office first, then extend through the Madrid
   Protocol. Until a registration issues, `TRADEMARK.md` says the marks are
   unregistered, and the license check fails on "®" or "registered trademark".

`scripts/check-license-consistency.mjs` now also reads `TRADEMARK.md`,
`NOTICE`, `CONTRIBUTING.md` and `COMMERCIAL-LICENSE.md`, the AGPL `LICENSE`
files, every copyright line, and every `SEE LICENSE IN` target.
`scripts/check-license-headers.mjs` covers `apps/` as well as `packages/`.

## Consequences

- Self-hosting stays free and complete; the June 2026 promise holds.
- Anyone combining the console into a closed product must now publish it or
  buy a license. Nothing in the MIT packages imports console code, so the SDK
  license is unaffected.
- The hosted service and a self-hosted stack can produce different wording or
  scores from the same report, because their tuning differs. The docs say so.
- Hosted tuning for spend-down thresholds needs a config read path that does
  not exist yet (the values are constants in `_shared/spend-down.ts`);
  BL-102 tracks it.
- A first-time outside contributor sees one extra bot comment.
- Until counsel reviews `CLA.md`, outside pull requests wait.

## Rejected

- **FSL, BSL or SSPL for the server.** The project left BSL four months ago,
  in public, calling it a credibility hit; going back reads as a bait and
  switch, and Redis shows the cost. None of them is OSI-approved, so "open
  source" would become false on every surface, and Linux distributions,
  package registries and many company policies treat them as proprietary,
  which cuts distribution. FSL (Sentry, GitButler) was the strongest
  alternative: it blocks a competing hosted service outright and converts to
  a permissive license after two years. It was rejected because AGPL plus the
  commercial license already blocks a closed competing service, and because
  the self-host promise is easier to believe under an OSI license.
- **Keeping the console MIT.** It is the product's face; MIT lets a rebrand
  ship it closed.
- **Removing the baseline prompts from the repository.** Self-host would stop
  being complete, which breaks the public promise.
- **A DCO instead of a CLA.** A DCO certifies origin but grants the
  maintainer nothing beyond the project license, so the commercial license
  could not cover outside contributions.
- **Claiming "registration in progress" before an application is filed.**
