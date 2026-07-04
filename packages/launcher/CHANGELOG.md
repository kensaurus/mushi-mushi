# mushi-mushi

## 0.7.16

### Patch Changes

- Updated dependencies [44b68c3]
  - @mushi-mushi/cli@0.24.0

## 0.7.15

### Patch Changes

- Updated dependencies [8544e22]
  - @mushi-mushi/cli@0.23.0

## 0.7.14

### Patch Changes

- Updated dependencies [90bc9d5]
  - @mushi-mushi/cli@0.22.0

## 0.7.13

### Patch Changes

- Updated dependencies [55e35a7]
  - @mushi-mushi/cli@0.21.0

## 0.7.12

### Patch Changes

- Updated dependencies [7b44c97]
- Updated dependencies [8a58313]
  - @mushi-mushi/cli@0.20.0

## 0.7.11

### Patch Changes

- 08108e6: Fix broken console URLs in CLI — setup wizard now opens the correct admin path

  The `npx mushi-mushi` setup wizard and `mushi login` were sending users to
  `https://kensaur.us/mushi-mushi/projects` (missing the `/admin` segment), which
  times out and does not resolve. All hardcoded console URLs in `cli-shared.ts`,
  `commands/diagnostics.ts`, `commands/project.ts`, and `index.ts` now route
  through the `consoleUrl()` / `resolveConsoleUrlSync()` helpers that include the
  correct `/admin` base path. The published dist previously predated this fix.

  Also corrects the `index.ts` help text: `MUSHI_API_KEY` is a `report:write`
  ingest key (from Onboarding → Verify), not a Settings → API Keys BYOK key.

- Updated dependencies [08108e6]
- Updated dependencies [08108e6]
  - @mushi-mushi/cli@0.19.0

## 0.7.10

### Patch Changes

- 3e1a441: Republish the `npx mushi-mushi` launcher so it tracks the latest `@mushi-mushi/cli` again.

  The launcher was accidentally added to the Changesets `ignore` list on 2026-06-15 (PR #181), which froze it at `0.7.9` (pinned to `@mushi-mushi/cli@^0.17.0`) while the CLI kept shipping through `0.18.x`. As a result `npx mushi-mushi` users were stuck a week behind. Un-ignoring the package restores the automatic `workspace:^` patch cascade from the CLI, and this changeset forces an immediate republish that re-pins the launcher to the current CLI range.

## 0.7.9

### Patch Changes

- Updated dependencies [59d6fce]
  - @mushi-mushi/cli@0.17.0

## 0.7.8

### Patch Changes

- Updated dependencies [c0eb84b]
  - @mushi-mushi/cli@0.16.0

## 0.7.7

### Patch Changes

- Updated dependencies [ae878a1]
  - @mushi-mushi/cli@0.15.0

## 0.7.6

### Patch Changes

- Updated dependencies [144906a]
  - @mushi-mushi/cli@0.14.0

## 0.7.5

### Patch Changes

- Updated dependencies [be12eae]
  - @mushi-mushi/cli@0.13.0

## 0.7.4

### Patch Changes

- Updated dependencies [fe80cd2]
  - @mushi-mushi/cli@0.12.0

## 0.7.3

### Patch Changes

- Updated dependencies [a7d6ae8]
  - @mushi-mushi/cli@0.11.0

## 0.7.2

### Patch Changes

- Updated dependencies
- Updated dependencies [0c66aa9]
  - @mushi-mushi/cli@0.10.0

## 0.7.1

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @mushi-mushi/cli@0.9.0

## 0.7.0

### Minor Changes

- 506df78: feat(admin): Codebase Atlas (/explore) — force-directed graph of indexed source

  New `/explore` route in the admin console visualises your indexed codebase as a
  force-directed ReactFlow graph. Nodes are coloured by architectural layer
  (UI, Lib, Backend, Test, Config, Other). Three view modes:
  - **Graph** — interactive ReactFlow canvas with layer-filter pills
  - **Layer Sankey** — horizontal lane diagram showing files per architectural tier
  - **Search** — semantic search via the `match_codebase_files` embedding RPC

  New server endpoints supporting the page:
  - `GET /v1/admin/projects/:id/codebase/explore` — returns `{ nodes, edges, layers, total_files }`
  - `POST /v1/admin/projects/:id/codebase/search` — semantic search returning top-k similar files

  New semver utility (`semver.ts`) for build-time vs changelog version comparison
  in the VersionBadge component, replacing ad-hoc string splits.

- c2fe328: feat(admin): Cost console overhaul + Settings UX polish

  **Cost page (`/cost`)**
  - Merged `llm_invocations` (primary telemetry) with legacy `llm_cost_usd` ledger into
    one unified cost view — no gaps between old and new telemetry sources.
  - New `CostRawLogTable`: server-side pagination, sort (7 columns), and full-text search
    across operation names, models, and IDs. Powered by URL-synced query params so deep
    links work (`?log_sort=cost_usd&log_order=desc`).
  - Backend `/v1/admin/costs` endpoint rewritten to support `page`, `limit`, `sort`,
    `order`, `q` params and return a `{ rows, total, capped }` payload. Falls back to
    the legacy ledger for search across both sources with dedup by ID.
  - Summary cards (By operation, By model) now use `OperationChip` for click-through
    to the operation's admin page.

  **Settings panels**
  - New shared primitives: `SettingsPanelLayout` (2-col lg grid), `SettingsCard`,
    `SettingsFormFooter` (sticky save/discard bar), `SettingsChangeHint` (inline
    "Was: X" delta), `settingsDiff` utilities.
  - `GeneralPanel`, `FirecrawlPanel`, `DevToolsPanel`, and `ByokPanel` all migrated
    to the new layout primitives — unsaved changes tracked, change count shown,
    sticky save bar replaces scattered per-field save buttons.

  **New chip components**
  - `OperationChip` — colour-coded by pipeline category (ingest/fix/iterate/release/intel/qa/ops).
  - `PipelineStageChip` — links to the owning admin page.
  - `AuditResourceChip` — resource-type chip with tooltip and nav link.
  - All chips backed by typed registries (`llmOperations.ts`, `pipelineStages.ts`,
    `auditResources.ts`) with ELI5 descriptions.

  **`PageHelp` component enhanced**
  - New `PageHelpPanel` with full-width 2-col layout, related-page flow links,
    rich text body, and a "Keep tips open on every page" localStorage preference.
    Cross-tab sync via `CustomEvent`. Auto-open for first-time visitors only.

  **Tooltip API widened**
  - `Tooltip.content` now accepts `ReactNode` (was `string`), enabling rich tooltip
    bodies used by all new chip components.

### Patch Changes

- 506df78: fix(cli): robust sync endpoints, new commands, shell-safe setup wizard

  **CLI v0.7.0 additions:**
  - New commands: `whoami`, `ping`, `reports resolve/reopen/dismiss/search`, `lessons list/show`
  - All commands use `/v1/sync/*` API-key-authenticated endpoints — no Supabase JWT required
  - Robust `apiCall()`: safe JSON parsing, 15 s timeout, typed `ApiResult<T>`, clear exit codes (0/1/2/3)
  - Config loading now respects `MUSHI_API_KEY`, `MUSHI_PROJECT_ID`, `MUSHI_API_ENDPOINT` env vars over `~/.mushirc`

  **Server `/v1/sync/*` endpoints (apiKeyAuth):**
  - `GET /v1/sync/whoami` — verify key + return project name and report summary
  - `GET /v1/sync/stats` — accurate DB-level counts (no 1 000-row cap) for status/severity/fixes/lessons
  - `GET /v1/sync/reports` + `GET /v1/sync/reports/:id` + `PATCH /v1/sync/reports/:id` — list, show, triage/resolve/reopen/dismiss
  - `GET /v1/sync/lessons/:id` — fetch a lesson by ID
  - `POST /v1/sync/codebase/upload` — ingest source file into the vector index

  **Bug fixes:**
  - `@mushi-mushi/mcp` setup guidance now uses the correct package name (`@mushi-mushi/mcp`, not `mushi-mcp`)
  - `/v1/sync/stats` uses DB-level HEAD count queries instead of client-side row counting, eliminating silent 1 000-row cap
  - Setup wizard SDK banner respects the user's selected framework tab when detection confidence < 50%
  - frameworkDetect uses shell-safe `your-app` placeholder (no angle brackets) and `your-app` fallback (no spaces)

- 76501f1: fix(seo): add X-Robots-Tag noindex to /mushi-mushi/\* 302 redirect responses

  CloudFront SPA router now sets `x-robots-tag: noindex, nofollow` on the 302
  redirect that bounces bare `/mushi-mushi/<route>` paths to `/mushi-mushi/admin/`.
  Google Search Console was indexing 47 redirect-source URLs because the 3xx
  response itself carried no hint — even though the destination SPA shell already
  has `<meta name="robots" content="noindex">`. Adding the header at the edge
  drops those entries on the next crawl without waiting for the destination to
  be re-evaluated.

  Also adds:
  - `scripts/bootstrap-publish-new-packages.mjs` — one-shot npm bootstrap script
    for new `@mushi-mushi/*` packages that can't use OIDC on first publish (npm
    limitation, see npm/cli#8544). Run with `pnpm bootstrap:new-npm-packages`.
  - `docs/HANDOVER-2026-05-05-npm-trusted-publisher-bootstrap.md` — step-by-step
    handover guide for configuring Trusted Publisher after first publish.

- acdf1fe: fix(cli): accept UUID project IDs and read config from env vars
  - `PROJECT_ID_PATTERN` now accepts both UUID format (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)
    and the `proj_xxx` prefix format. All existing projects use UUID format from
    `gen_random_uuid()`. The `proj_xxx` format was never actually used by the backend.
  - `loadConfig()` now overlays `MUSHI_API_KEY`, `MUSHI_PROJECT_ID`, and
    `MUSHI_API_ENDPOINT` env vars over the `~/.mushirc` file so CI pipelines and
    `npx @mushi-mushi/cli sync-lessons` work without an interactive `mushi init` first.
  - Error messages, placeholders and the non-interactive example now show the UUID format.
  - `sync-lessons` command now calls `/v1/sync/lessons` (API-key-authenticated) instead of
    `/v1/admin/lessons` (JWT-authenticated) so it works with the project API key.

- Updated dependencies [506df78]
- Updated dependencies [acdf1fe]
- Updated dependencies [acdf1fe]
- Updated dependencies [506df78]
  - @mushi-mushi/cli@0.8.0

## 0.6.5

### Patch Changes

- Updated dependencies [59627e2]
  - @mushi-mushi/cli@0.7.0

## 0.6.4

### Patch Changes

- 2d27c86: Re-publish to refresh the npm landing page with the v2-era README and
  description updates.

  The previous publish (`0.6.3`, 2026-04-29) shipped before the v2
  "bidirectional inventory + agentic-failure gates" changes landed and
  before the README enhancement pass that documents v2 capabilities,
  the bundled glot.it integration, and the updated supported-frameworks
  matrix. Local `0.6.3` and the registry tarball drifted apart even
  though the version numbers matched.

  This patch is a no-op runtime change — same `dist/` artefacts — but
  bumps the version so `npm publish` ships the current README + package
  description tarball-side. End users hitting npmjs.com/package/mushi-mushi
  will now see the v2 positioning and the up-to-date framework list.

## 0.6.3

### Patch Changes

- Updated dependencies [b9666a7]
  - @mushi-mushi/cli@0.6.0

## 0.6.2

### Patch Changes

- b441c55: - **Supply-chain hardening** workspace-wide 7-day cooldown on new dep
  versions (pnpm `minimumReleaseAge` + npm `min-release-age` + Dependabot
  `cooldown`), plus PR-time `dependency-review-action`, post-publish
  `npm audit signatures`, `strictDepBuilds`, and `blockExoticSubdeps`.
  Closes the window real-world npm attacks operate in (Axios 1.14.x: ~5h to
  detection; Shai-Hulud worm: ~12h) — every publicly-disclosed 2025–2026
  npm supply-chain attack would have been blocked by these defaults.
  - **Launcher README** adds a Socket.dev badge and a new "Supply-chain &
    verification" section that explains, up front, what each external scanner
    reports about `mushi-mushi` (npm provenance, Socket.dev alerts,
    Bundlephobia `EntryPointError`, Snyk Advisor crawler lag) and why none
    of them are actionable bugs.
  - **CLI** bumped `@clack/prompts` from `^0.11.0` to `^1.2.0`. v1 widened
    the `text({ validate })` callback parameter to `string | undefined`; the
    `requireSecret()` helper was updated to handle the new signature
    explicitly. No user-visible change; the v1 spinner-API breaking change
    isn't used here.

  Repo settings (no code change): GitHub Discussions and Dependabot security
  updates were enabled via `gh api`.

- Updated dependencies [b441c55]
  - @mushi-mushi/cli@0.5.3

## 0.6.1

### Patch Changes

- d4d6933: Growth plan — storefronts pass (2026-04-24)

  Phase 0 of the zero-budget 90-day growth plan: polishing the npm pages and
  README so they convert attention into stars and installs. No behaviour changes;
  metadata only.
  - **npm keyword arrays expanded across all 14 publishable packages.** Added
    discoverability terms developers actually type into npm search:
    `user-report`, `feedback-widget`, `sentry-alternative`, `auto-fix`,
    `llm-ops`, `ai-agent`, plus framework-appropriate specifics (e.g.
    `claude-code`, `codex`, `copilot` on `@mushi-mushi/mcp`). Keyword counts
    after the pass: 14–32 per package.
  - **README star CTA footer.** Added the bilingual _"もしMushi-chanのお役に立てたら、
    ⭐ をひとつ"_ line with links to the stargazers page, issue tracker, and
    Bluesky handle. Research says a single explicit star ask converts 2–5% of
    lurkers.
  - **New `docs/marketing/` folder** with the full growth kit: `VOICE.md`,
    `STOREFRONTS.md`, `snippets.md` (drafted hooks, Show HN, Reddit, LinkedIn,
    dev.to, Product Hunt, YouTube Short), `launch-week.md`, `content-plan.md`
    (8 compounding blog post outlines), `drip-channels.md` (11 awesome-lists,
    9 newsletter targets, Discord / Slack etiquette), `social-cadence.md`
    (Bluesky / X weekly rhythm), and `measurement.md` (the 5 numbers to watch
    each Friday).

  No SDK surface or runtime changes — safe to land before any launch week.

- d4d6933: Marketing automation toolkit (`scripts/marketing/`) + mascot kit + GitHub repo chrome live

  Implements the automatable half of the [`docs/marketing/`](../docs/marketing/)
  growth plan. Six zero-dep scripts that handle everything boring and
  transactional, while keeping the relational parts (HN / Reddit / Product
  Hunt / Discord engagement) where they belong — with a human, on the
  keyboard, in the comments.

  **Scripts (all under `scripts/marketing/`):**
  - `setup-github.mjs` — sets repo About + 20 topics + opens the awesome-list
    contributor good-first-issue. Idempotent. **Already applied** to
    `kensaurus/mushi-mushi` (issue [#38](https://github.com/kensaurus/mushi-mushi/issues/38)).
  - `seed-demo.mjs` — fires 5 realistic, classifier-spread bug reports
    (covers `bug`/`slow`/`visual`/`confusing`) into the live admin so first-time
    visitors land on a dashboard that looks alive. Tags every report with a
    `seed_batch` so the seed set is identifiable / sweepable.
  - `post-devto.mjs <slug>` — publishes a markdown post under
    `docs/marketing/posts/<slug>.md` to dev.to via their first-class API.
    Drafts by default; `--publish` to go live. Re-runs UPDATE in place
    (matched by title) so we never duplicate articles.
  - `post-bluesky.mjs` — drains
    `docs/marketing/social/queue.json` to Bluesky via the AT Protocol.
    Self-labels as a bot, persists session, computes rich-text facets for
    links + hashtags. Zero deps.
  - `propose-awesome-pr.mjs` — one PR at a time: forks an awesome-list,
    alphabetically slots the Mushi entry into the named section, opens the
    PR with a thoughtful body. Explicitly NOT a bulk submitter — list
    maintainers reject those on sight.
  - `record-readme-gif.mjs` — Playwright walks the live demo end-to-end
    (dashboard → reports → detail → fixes) and outputs
    `docs/screenshots/hero.{webm,gif,webp}` with palette-optimised ffmpeg
    conversion.

  **Assets shipped:**
  - `docs/mascot/` — four expressions of Mushi-chan (happy / worried /
    sleeping / waving), generated as a consistent character set with a
    README documenting palette, vibe, and regeneration prompt.
  - `docs/social-preview/og-card.png` — 1280×640 dark-themed OG card with
    Mushi-chan + the _"Sentry sees what your code throws / Mushi sees what
    your users feel"_ tagline, ready to drop into Settings → Social preview.

  **Content seeded:**
  - `docs/marketing/posts/01-auto-fix-loop.md` — first dev.to post, **already
    uploaded as a draft** to the kensaurus dev.to account (article #3539918,
    ready for human review + publish).
  - `docs/marketing/social/queue.json` — first batch of 5 Bluesky posts in
    Mushi-chan's voice, ready to drain once `BLUESKY_HANDLE` is set.

  **Deliberately NOT automated** (with rationale documented in
  `scripts/marketing/README.md`): Hacker News / Reddit / Product Hunt /
  LinkedIn / X / Discord posts, comment replies, and the actual launch.
  Automating those would either trigger anti-spam stacks (HN, Reddit), violate
  ToS (LinkedIn), require paid API access (X), or — most importantly —
  destroy the authentic-presence value that makes those channels worth
  posting on.

- Updated dependencies [d4d6933]
  - @mushi-mushi/cli@0.5.2

## 0.6.0

### Minor Changes

- 71b2fe8: Full-PDCA dogfood hardening wave (2026-04-22).

  Web SDK:
  - New `@mushi-mushi/web/test-utils` entry-point exposing `triggerBug()`,
    `openReport()`, and `waitForQueueDrain()` for deterministic Playwright
    round-trips. Import from `@mushi-mushi/web/test-utils` — zero cost at
    runtime for production bundles.
  - Tightened size-limit budget to 15 KB gzipped (previously 30 KB
    uncompressed). No API changes.

  Core SDK:
  - No code changes; bumped for consistency with the `web` SDK so
    downstream frameworks pick up the new test-utils exports transitively.

  Framework SDKs (react / vue / svelte / angular / react-native /
  capacitor / node):
  - No code changes. Coupled minor bump so the workspace stays on a single
    MAJOR.MINOR track; patch-only drift across adapters has historically
    caused dependency-resolution confusion for customers.

  Launcher:
  - Rewired the Claude Code agent adapter behind the new
    `MUSHI_ENABLE_CLAUDE_CODE_AGENT=1` flag and wired it up to the local
    `claude` CLI (binary path overridable via `MUSHI_CLAUDE_CODE_BIN`).
    The README "Status" column now reflects "working — opt-in".

## 0.5.2

### Patch Changes

- 23a8cb5: Rewrite the `mushi-mushi` npm README so the package page tells a story in the first scroll instead of dropping visitors into wizard mechanics. Inspired by `vite`, `prisma`, and `@trpc/server` on npmjs.com:
  - **Hero image up top.** `docs/screenshots/report-detail-dark.png` is now embedded (via absolute `raw.githubusercontent.com` URL so npmjs.com renders it), linking to the live admin demo.
  - **15-word tagline.** "Ship a shake-to-report button. Get AI-classified, deduped, ready-to-fix bug reports." Frameworks listed directly under.
  - **"What you get"** — 6 benefit bullets with emoji, each tied to a capability, not a wizard step.
  - **"Who it's for"** — 4 personas (solo dev, PM/designer, AI-native team, enterprise) so visitors self-identify in 10 seconds.
  - **"Mushi vs your existing stack"** — 9-row comparison table showing what Sentry/Datadog miss. Makes the companion-not-replacement positioning concrete.
  - **"Integrates with"** — 10-cell grid covering GitHub, Sentry, Slack, Jira, Linear, PagerDuty, Langfuse, Cursor, Claude Code, Zapier. Plus a line for Datadog/New Relic/Honeycomb/Grafana via `@mushi-mushi/adapters`.
  - **Pipeline diagram** — ASCII flow showing widget → fast-filter → deep classify → dedup → judge → dispatch-fix. Points at the root README for the full architecture.
  - **Flags, troubleshooting, security** — collapsed into `<details>` so they stop occupying the hero viewport but stay searchable.

  Also updates `package.json` `description` from wizard-mechanics ("launcher auto-detects your framework…") to use-case-first ("Ship a shake-to-report button and get AI-classified, deduped, ready-to-fix bug reports…"), with every integration named so the npm search index picks up on them.

  No behaviour changes to the launcher binary.

## 0.5.1

### Patch Changes

- 6e01dc7: Ship `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md` inside every published tarball, and enable npm provenance (sigstore-signed build attestation) for every publishable package. Both changes target package-health signals surfaced by Snyk (`security.snyk.io/package/npm/<name>`) and Socket (`socket.dev/npm/package/<name>`):
  - **Community files in-tarball.** Snyk and Socket only credit community signals when the files are shipped inside the npm tarball, not when they live at the monorepo root. A pre-commit guard (`scripts/sync-community-files.mjs --check`) and the `pnpm release` script now auto-sync from the canonical root copies to prevent drift.
  - **`publishConfig.provenance: true` everywhere.** The Release workflow already set `NPM_CONFIG_PROVENANCE=true` at the job level, but per-package `publishConfig` is the explicit signal Socket reads for its Supply Chain score. `@mushi-mushi/cli`, `create-mushi-mushi`, and `mushi-mushi` already had it; the remaining 20 publishable packages now match.
  - **`.github/FUNDING.yml`** points at GitHub Sponsors so the repo exposes a funding signal to scanners and the GitHub UI.

  No runtime behaviour changes. No breaking changes for consumers.

- Updated dependencies [6e01dc7]
  - @mushi-mushi/cli@0.5.1

## 0.5.0

### Minor Changes

- 18572f7: **Security + UX hardening sweep for the installer trio.**

  Security:
  - `~/.mushirc` is now written with mode `0o600` on Unix. On load, existing files written with looser permissions are proactively chmod'd down so upgrading users are not exposed to other local users on a shared box.
  - Package-manager install no longer uses `shell: true`. We resolve the platform-specific executable (`npm.cmd` on Windows, `npm` elsewhere) and spawn with `shell: false`, closing the door on future shell-metacharacter injection if arbitrary arg forwarding is ever added.
  - Credentials pasted into the wizard are sanitized (stripped of surrounding quotes, whitespace, and CR/LF/NUL) and validated against `^proj_[A-Za-z0-9_-]{10,}$` / `^mushi_[A-Za-z0-9_-]{10,}$` before they're written to disk. Prevents `.env` injection via newlines in a pasted secret.
  - `--endpoint` URLs now require `https://` except for localhost / `.local` / link-local addresses. Typo'd `http://` endpoints are rejected instead of silently exfiltrating the API key.
  - All three published packages now declare `publishConfig.provenance: true` (belt-and-suspenders with the existing `NPM_CONFIG_PROVENANCE=true` in CI) so the npm page shows the verified-publisher badge on every release.
  - New `.github/workflows/security.yml` runs CodeQL (security-extended) + `pnpm audit --prod --audit-level=high` on every PR and weekly via cron.

  UX:
  - `mushi --version` now reports the real package version instead of the stale hardcoded `0.3.0`.
  - Launcher & create-mushi-mushi gained `--version`, `--cwd`, `--endpoint`, `--skip-test-report`, and a non-TTY bail-out that errors clearly instead of hanging on `@clack/prompts` in CI.
  - End-of-wizard "Send a test report now?" prompt closes the loop: the user sees their first classified bug in the console without leaving the terminal.
  - `.gitignore` detection now covers the common patterns (`.env*.local`, `.env.*.local`, `*.local`, `*.env*`) so the "not gitignored" warning stops crying wolf.
  - Monorepo / sub-package support via `--cwd <path>` forwarded from the shims.
  - Error handler on the shims now hints at `DEBUG=mushi` for stack traces and links to the issue tracker.
  - Dead `writeFileSync(readFileSync(...))` round-trip in `writeEnvFile` removed.

  Housekeeping:
  - `funding` field (`https://github.com/sponsors/kensaurus`) added to all three packages.
  - New `./version` subpath export on `@mushi-mushi/cli`.
  - Shared `FRAMEWORK_IDS` / `isFrameworkId` exported from `@mushi-mushi/cli/detect` so the three-file duplicate of the framework list no longer has to be kept in sync.
  - Integration tests for the shims (`--help`, `--version`, unknown framework, unknown flag, non-TTY bail-out) and permission-mode tests for `~/.mushirc`.

### Patch Changes

- Updated dependencies [18572f7]
  - @mushi-mushi/cli@0.5.0

## 0.4.0

### Minor Changes

- fc5c58e: **One-command setup wizard + npm discoverability sweep.**
  - **`@mushi-mushi/cli` `0.3.0`**: New `mushi init` command — interactive wizard built on `@clack/prompts` that auto-detects framework (Next, Nuxt, SvelteKit, Angular, Expo, Capacitor, plain React/Vue/Svelte, vanilla), package manager (npm/pnpm/yarn/bun), installs the right SDK, writes env vars with the right prefix (`NEXT_PUBLIC_`, `NUXT_PUBLIC_`, `VITE_`), warns when `.env.local` isn't gitignored, and prints the framework-specific snippet. Idempotent: never overwrites existing `MUSHI_*` env vars. Exposes new `./init` and `./detect` subpath exports for downstream packages.
  - **`mushi-mushi` `0.3.0` (NEW, unscoped)**: One-command launcher — `npx mushi-mushi` runs the wizard. Gives the SDK a single brand entry point on npm so users don't have to know to look under `@mushi-mushi/*` first.
  - **`create-mushi-mushi` `0.3.0` (NEW)**: `npm create mushi-mushi` — same wizard via the standard npm-create convention.
  - **All 16 published packages**: keyword sweep — every package now ships `mushi-mushi` plus its framework-specific terms (`react`, `next.js`, `vue`, `nuxt`, `svelte`, `sveltekit`, `angular`, `react-native`, `expo`, `capacitor`, `ionic`, etc.) plus product terms (`session-replay`, `screenshot`, `shake-to-report`, `sentry-companion`, `error-tracking`, `ai-triage`) for npm search ranking.
  - **All SDK READMEs**: discoverability cross-link header at the top — points users to the wizard and to every other framework SDK so people who land on `@mushi-mushi/react` can find `@mushi-mushi/vue` and vice-versa.
  - **Root README**: quick-start now leads with `npx mushi-mushi`, with the manual install path documented as the fallback. Packages table gains a row for the launcher.

### Patch Changes

- Updated dependencies [fc5c58e]
  - @mushi-mushi/cli@0.4.0
