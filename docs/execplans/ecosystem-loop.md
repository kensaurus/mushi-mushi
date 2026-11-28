# Plan 025 — The ecosystem loop: idea → feedback → review → fix → proof → video → release

Status: owner approved every phase on 2026-11-27 ("all approved — make sure
they are immersive and interactive and graphical UI/UX too"). Progress:

| Phase | State (worktree `.claude/worktrees/loop-timeline`, branch `feat/loop-timeline`, uncommitted) |
|---|---|
| P0 | **Done (done-when met, see "P0 residual" below).** Config with today's value as default: `MUSHI_PUBLIC_ORIGIN`, `SUPPORT_EMAIL` (ADR 0015 value), `MUSHI_UX_SKILLS_REPO`, `MUSHI_SDK_TEMPLATE_REPO`. Framework-driven, never slug-driven: env-var names (`projectMushiEnv.ts` `mushiEnvVarsForProject`), SDK snippets, the default SDK tab, the server stack guess (`sdk-diagnostics.ts inferStack`), the Expo banner (by `sdk_package`), Setup Copilot (dogfood script hints removed). Mushi's own console = the project in `VITE_MUSHI_SELF_PROJECT_ID`. Core favicons: per-app tables removed; app icon, repo, SDK origin and caller-given `shared_hosts`. Content-quality callback reads `X-Mushi-Signature`, accepts `X-Glotit-Signature` as deprecated legacy. Left to the P2/P3 branch by agreement: `packages/ux/src/fresh-eyes.ts presetFor`, `FreshEyesPanel.tsx`. |
| P1 | **Built.** Migration `20261127130000_ux_timeline.sql` (not deployed), `_shared/ux-timeline.ts`, `api/routes/ux-timeline.ts` (api-ext), retention `sweepUxBaselines`, console `/timeline` (rail, filmstrip, compare slider, month summary), ADR 0072. |
| P7 | **Partly built:** `get_timeline`, `get_surface_history`, `get_ux_run`, `start_ux_run` (returns the console link and command; starts nothing, ADR 0017/0020). Other P7 tools belong to P2–P6. |
| P8 | **Built for the scorecard and the loop review:** verdict cache by capture hash (`_shared/ux-score-cache.ts`), the loop review skips unchanged and seen pairs, cost per page/run (`ux_surfaces.cost_usd`, `ux_runs.cost_usd`), shown per run, release and month on the Timeline. |

Decided in this batch (ADR 0072): `start_ux_run` returns the console link and
the local command and never starts a run (ADR 0017/0020); auto-pinning on
release publish is an opt-in project setting, off by default.

## Before deploy (this batch, owner)

1. **Apply the migration first:** `20261127130000_ux_timeline.sql`, then deploy
   `api-ext`, `api` and `retention-sweep` (and the functions that import
   `_shared/release-publish.ts`: `release-builder`, `webhooks-github-indexer`,
   `mcp`). The UX runs list and the scorecard's `/score` already read and write
   the new columns, so deploying functions first breaks them.
2. **Set `projects.icon_url` for the dogfood projects** before the console
   ships. The SDK's per-app favicon tables are gone (P0), so without a stored
   icon these show initials. This is a data change for a person to make; no
   code sets it. Slugs, with the icon each one used to get from the removed
   table:

   | Project slug | Suggested `icon_url` (the removed table's value) |
   |---|---|
   | `the-wanting-mind` | `https://kensaur.us/the-wanting-mind/pwa-512x512.png` |
   | `glot-it` | `https://kensaur.us/glot-it/apple-touch-icon.png` |
   | `yen-yen` | `https://kensaur.us/yen-yen/icon.svg` |
   | `how-to-talk-to-girls` (lets-talk) | `https://talk.kensaur.us/pwa-192.png` |
   | `help-her-take-photo` (hhtp) | `https://kensaur.us/help-her-take-photo/assets/apple-touch-icon.png` |

   Also in that table, optional: `mushi-mushi` →
   `https://kensaur.us/mushi-mushi/admin/favicon.svg`, `solo-boss-cloud` →
   `https://solo-boss.kensaur.us/favicon.svg`, `tsumagoi` →
   `https://tsumagoi.kensaur.us/apple-touch-icon.png`. A project that already
   has a store icon in `icon_url` needs nothing.
3. **CloudFront:** push `scripts/cloudfront-mushi-docs-response.js` (noindex
   list gains `admin/timeline`) with `scripts/aws-configure-docs-errors.mjs`.
4. **Content-quality webhook:** existing senders of `X-Glotit-Signature` keep
   working; switch them to `X-Mushi-Signature` at their next deploy.

## P0 residual (done-when, 2026-11-27)

`git grep -i -E "kensaur|glot|tsumagoi|yen-yen|the-wanting-mind|help-her"` over
`apps/` and `packages/` (tests, fixtures, Markdown, changelogs and `apps/docs`
excluded): 1973 lines in 605 files. None is a product code path that treats one
tenant differently. Each bucket, with why it stays:

| Bucket | Lines / files | Why it stays |
|---|---|---|
| Hosting-company infrastructure | 980 / 65 | The KENSAURUS spine copies, wallet, AI-route client, price catalog and the operator Ops/Providers pages: the hosting company's shared systems the hosted service runs on (ADR 0039 amendment), not any tenant's app. Byte-identical vendored copies are checked by `check:spine`. |
| Package and store metadata | 358 / 224 | `homepage`, `repository`, `author`, licence and copyright headers, podspec/pubspec/gradle coordinates: the publisher's identity on npm, CocoaPods, pub.dev and Maven. |
| Comments | 358 / 225 | Code comments and JSX comments recording where a bug was found ("glot.it, 2026-10-21"). History, never executed. |
| The product's own hosted identity | 168 / 99 | Links to `kensaur.us/mushi-mushi/…` docs and console, the `kensaurus/mushi-mushi` repo and its composite actions, the `@kensaurus` npm scope, the support inbox (ADR 0015), the DTCG extension key `us.kensaur.mushi` (a stored data contract), the public skills catalog `kensaurus/skills` offered as a starting source. These name Mushi itself, not a tenant; the hosted origin is overridable through `MUSHI_PUBLIC_ORIGIN`. |
| Applied migrations | 71 / 29 | Migration files already applied to production are immutable history. |
| Config defaults | 5 / 4 | Today's value as the default of a setting (`MUSHI_SDK_TEMPLATE_REPO`, `MUSHI_PUBLIC_ORIGIN`, `MUSHI_UX_SKILLS_REPO`, `.env.example`). |
| Other | 33 / 24 | JSX comment continuations, generated console-help text that repeats the skills-catalog suggestion, operator-only routes under `/v1/admin/kensaurus/ops`, and `packages/mcp/scripts/test-all-tools-yenyen.py` (a maintainer's dev script, not shipped). |

Owned by the P2/P3 branch and excluded here by agreement:
`packages/ux/src/fresh-eyes.ts` (`presetFor`) and `apps/admin/src/components/ux-runs/FreshEyesPanel.tsx`.

## Why

Mushi is a platform for any solo founder running vibe-coded apps and
services. It is not a kensaurus tool.

**The loop:**
1. The founder's idea is the vision, and user feedback is the steering. Feedback arrives through the Mushi widget and store reviews.
2. Persona agents review the app with screenshots, and fixes and UX changes land, automatically when the owner opts in.
3. A security scan proves each release.
4. Screenshots and product videos are refreshed and pushed to App Store, Google Play and GTM channels through lazycow.
5. Mushi shows the whole history, so the founder sees each idea getting better.

The five kensaurus apps (TWM, glot.it, yen-yen, lets-talk, hhtp) are the
dogfood tenants and the living proof. They are never special-cased in
product code.

**The owner's guardrails:**
- Build for the general public.
- Keep LLM token cost low.
- Every automatic step is opt-in and capped.

## What already exists (origin/master, read 2026-11-27)

| Capability | Status | Where |
|---|---|---|
| Feedback intake from every SDK → classify → cluster → fix PR → proof-verify → merge queue → release trains | **Exists**, project-scoped + RLS | `packages/{web,ios,android,flutter,react-native,capacitor}`; `functions/api/routes/public.ts:418`; fix-worker; `_shared/github-pr.ts`; ADR 0035/0041/0044 |
| Automatic iteration | **Exists**, opt-in, default off, spend caps | `project_settings.autofix_*`, `auto_decide_enabled` (ADR 0055), `auto_release_enabled`; `_shared/autofix-budget.ts` |
| UX runs (Playwright screenshots, probes, Opus judge, PR) | **Partial**: web only, no video | `packages/ux/src/{capture,audit,judge,cli}.ts`; tables `ux_runs/ux_surfaces/ux_iterations`; bucket `ux-captures` |
| Personas | **Partial**: 5 fixed rubric critics; fresh-eyes takes a typed goal | `agent_personas` seed; `packages/agents/src/pdca.ts`; `packages/ux/src/fresh-eyes.ts` (ADR 0053) |
| Screenshot history | **Partial**: before/after per run, a 12-run score sparkline; captures deleted after 30 days | `UxSurfaceDetail.tsx:57-93`; `ux-scorecard.ts:85`; `project_settings.ux_capture_retention_days` |
| Security | **Partial**: dependency + runtime advisories (OSV, KEV, EPSS) and radar app-hole checks | `_shared/vuln-watch.ts`, `osv.ts`, `_shared/radar/*` |
| Video | **Missing** in product | marketing scripts only |
| Store | **Partial**: ASC read-only, Play rollout writes behind approval, listing-as-code PRs | `_shared/connectors/{app-store-connect,play-console}.ts`; `_shared/store-listing.ts` |
| MCP | about 145 tools; **none** for UX runs, fresh-eyes, history, store writes, video | `packages/mcp/src/catalog.ts` |
| lazycow | Self-hosted Remotion 4.0.543 + ffmpeg reel studio; 27 MCP tools; posts to YouTube, Facebook, Bluesky (API) and X, TikTok, LinkedIn, Maps, LINE (browser helper); no link to Mushi | `lazycow-studio`: `src/*.tsx`, `server/mcp.mjs`, `docs/mcp.md`, `docs/openapi.yaml` |

## Research (sources read 2026-11-27)

- **Video engine.**
  - Remotion is free for individuals and for-profit companies with up to 3 employees; larger companies need a company licence. Source: remotion-dev/remotion `LICENSE.md`.
  - Whether a hosted platform rendering for its customers has extra terms is `[unverified]`.
  - Revideo (`midrender/revideo`, MIT, 0.11.0 2026-07-10) is a Motion Canvas fork with a headless `renderVideo()` API.
- **Decision:** video lives in **lazycow**, which is self-hosted, so each founder renders on their own machine and holds their own Remotion licence. Mushi never renders video.
- **Store specs.** Apple app previews are 15–30 s, H.264 or ProRes 422 HQ, at most 30 fps, with portrait sizes such as 886×1920, up to 3 per language. Source: developer.apple.com App preview specifications.
- **Security, which tools a hosted service may use:**
  - Anthropic `claude-code-security-review`: MIT, diff-aware, language-agnostic. Its README says it is **not hardened against prompt injection; review trusted PRs only**.
  - OSV-Scanner (Apache-2.0), Gitleaks (MIT), Nuclei (MIT), ZAP (Apache-2.0).
  - **Semgrep registry rules may not be offered as a service** (Semgrep Rules License v1.0, since Dec 2024), and the Opengrep rules carry a Commons Clause.
- **Decision:** scanners run in the founder's own CI and Mushi ingests SARIF/JSON. No licence exposure for Mushi; the founder's own keys and minutes.
- **Prior art for screenshots → video:** `codeverbojan/remotion-cinematic`, `Ashref-dev/openmotion` and `jayantdeveloper/repostudio` (all turn screenshots or Playwright captures into product videos). Playwright `recordVideo` covers real screen recordings on the web.

## Phases (each generic, config-driven, dogfooded on the kensaurus apps first)

### P0 — De-kensaurus the product paths (small, do first)

Move to project/org config or env:
- `apps/admin/src/components/IdentitySecretCard.tsx` (per-host map of three kensaurus apps)
- `ProjectFavicon.tsx:39-42` (`*.kensaur.us` allowlist)
- `lib/copy.ts:1704-1714` (glot.it dogfood narrative)
- `RevealedKeyCard.tsx:107-111`
- `lib/mushi-self.ts:110` and `FeedbackModal.tsx:43` (personal contact address)
- `packages/ux/src/skills.ts:23` (`DEFAULT_SKILLS_REPO`)
- `packages/ux/src/cli.ts` fresh-eyes `--mint-account` ("Mushi only")
- `_shared/hosted-llm-billing.ts` naming
- `packages/mcp/src/catalog.ts:444,474,596` (glot.it examples)

Hosted-domain constants (`console-url.ts`, `endpoint.ts`, `branding.ts`) become one `MUSHI_PUBLIC_ORIGIN` setting with today's value as the default.

**Done when:** a grep for `kensaur|glot|tsumagoi|yen-yen|the-wanting-mind|help-her` in `apps/` and `packages/` source (fixtures excluded) returns only config defaults and docs.

### P1 — The iteration timeline (the visual proof)

- **Baselines.** New `ux_baselines` (project, surface, viewport, release/version, capture path, score, created_at) pins one capture per surface per release. Pinned captures are exempt from the retention sweep; drafts keep 30 days.
- **Page.** A new console page, *Timeline* (per app), merges releases, the reports they closed, the UX iteration that changed each surface, and the baseline image before and after. Read from `releases`, `reports`, `ux_iterations`, `ux_baselines`.
- **Views.** A filmstrip per surface and a "what changed for users this month" view.
- **MCP.** `get_timeline`, `get_surface_history`.
- **Cost.** Images only, no LLM.

### P2 — Native apps in UX runs

- Generalise `mushi-ux scorecard --from-captures <dir>` (`packages/ux/src/cli.ts`) into an upload API (`POST /v1/ux/captures`) plus MCP `upload_ux_captures`.
- Any driver can feed it: Maestro flows, `adb exec-out screencap`, `xcrun simctl io booted screenshot`, or the SDKs' existing `ScreenshotCapture` in debug builds.
- Captures are PNG + `facts.json`, so the existing probes and judge apply unchanged.
- Ship a template flow per platform in `docs/templates/`.

### P3 — Personas as real user profiles

- New `project_personas` table (name, goal, locale, device, expertise, accessibility needs, patience/cost cap) next to the 5 rubric critics. Console CRUD with sensible presets (first-time user, power user, older user, Japanese user, screen-reader user).
- Fresh-eyes and PDCA take a persona id.
- Replace the "Mushi only" account mint with a per-project opt-in plus the existing TTL and rate limits.
- Reserve credits per run before it starts (today there is no per-run reservation for UX or fresh-eyes runs).

### P4 — Security proof stage

- Mushi writes `mushi-security.yml` into the founder's repo, like `docs/templates/mushi-ux.yml`:
  - **every PR:** OSV-Scanner + Gitleaks;
  - **opt-in:** `claude-code-security-review` on PRs from the owner or Mushi's own fix agents (trusted authors only, with the founder's own key);
  - **weekly:** ZAP baseline + Nuclei against the project's staging URL.
- Results are posted as SARIF to `POST /v1/security/results`. They become reports with source `security_scan` (the enum already has `security_advisory`), deduped against vuln-watch.
- A release shows a **Security proof** badge (scans green for that commit) on the timeline and in the release notes.
- No hosted Semgrep registry rules.

### P5 — Release kit → lazycow product video

- **Mushi side:** `release_kits` holds, per release, the baseline screenshots before and after, Playwright `recordVideo` clips of the top flows (web) or uploaded device recordings (native), changelog lines from `releases`, and brand tokens from project settings. Exposed through `export_release_kit` (MCP + API, a signed URL bundle).
- **lazycow side, its own repo:**
  - a source type that accepts screenshots and app recordings (today PNG/WebP are excluded: `py/studio/sources.py:298`, `server/dropbox.mjs:108`);
  - a `ProductPreview` Remotion composition with presets for App Store previews (15–30 s, at most 30 fps, H.264, 886×1920 etc.), the Play promo, and 9:16 social cuts;
  - an MCP tool `make_product_video({ kitUrl, preset })`, reusing `ai_review` (about $0.01 per review, cached) and its spend limits;
  - a Remotion licence note in `NOTICE`/README: companies over 3 employees need a Remotion company licence.
- **Hand-back:** lazycow returns the rendered file and Mushi attaches it to the release. Social posting stays in lazycow (`publish_reel`, approval first).

### P6 — Store publishing

- Extend `connectors/app-store-connect.ts` with screenshot and app-preview upload, and `play-console.ts` with listing images and promo video.
- Both go through the existing human-approved `connector-actions` path (as rollouts do today), then can be promoted to auto with `auto_release_enabled`.
- Listing text stays listing-as-code (`_shared/store-listing.ts`).

### P7 — MCP and CLI coverage

Add tools so agents can drive the whole loop: `start_ux_run`, `get_ux_run`, `start_fresh_eyes`, `list_personas`, `upload_ux_captures`, `get_timeline`, `export_release_kit`, `get_security_proof`. Update `packages/mcp/src/catalog.ts` and the hosted MCP function together (ADR 0008).

### P8 — Token cost

- Run the deterministic probes first.
- Call the judge only on surfaces whose capture hash changed. Today the judge runs once per run at the end; cache it by surface hash.
- Pass fresh-eyes findings on only when 2+ sessions agree (already the rule).
- Show the cost per run and per release on the timeline, so the founder sees what each improvement cost.

## Order

1. P0 + P1 first. They are cheap, make the loop visible, and prove it on the kensaurus apps.
2. Then P2 (native, where today's first-run problems were found).
3. Then P4 (security proof).
4. Then P5 with lazycow.
5. Then P3, P6, P7.
6. P8 runs through all phases.

## Owner decisions needed

1. **Approve P0 + P1 as the first batch.**
2. **Trusted authors for `claude-code-security-review`:** the owner's own PRs plus Mushi fix-agent PRs only (recommended).
3. **Baseline retention:** decided 2026-11-27: the last 24 releases per screen (`project_settings.ux_baseline_keep_releases`), a `pinned` shot kept forever.
4. **The lazycow side** is a separate repo and roadmap; confirm it takes P5.
