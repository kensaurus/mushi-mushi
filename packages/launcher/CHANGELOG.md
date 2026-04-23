# mushi-mushi

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
