# 0074. Security proof, release kits and store media

Status: Accepted (owner 2026-11-27, "approved on all lines"). The owner
approved every phase of Plan 025 that day ("all approved", then "implement
and enhance everything — approved on all lines"); the trusted-author rule for
the AI review was the owner's decision 2. Amends ADR [0017](0017-strike-the-plan-019-020-sequencing-gate.md)
decision 2.2 (S-1) for store **media** only (decision 13); listing **text**
stays as S-1 says. Date: 2026-11-27

Plan 025 P4 (security proof), P5 (release kit → lazycow product video) and P6
(store publishing), `docs/execplans/ecosystem-loop.md`. Part A (decisions
1–7) is the security proof; part B (decisions 8–14) is the release kit and
store media; part C (15–18) records the follow-ups, one of which amends
ADR 0044's express-lane list (decision 15).

Related (part A): ADR [0038](0038-known-vulnerability-findings-are-bugs.md) (known holes
are bugs; no top-level Security page; vuln-watch), ADR
[0036](0036-licensing-posture.md) (licensing), ADR
[0017](0017-strike-the-plan-019-020-sequencing-gate.md) (a check that never ran
is `unknown`, never green), ADR [0044](0044-release-trains-batch-approved-fixes.md)
(releases), Plan 025 P4 (`docs/execplans/ecosystem-loop.md`). Code:
`docs/templates/mushi-security.yml` (kept byte-identical in
`_shared/security-workflow.ts`), `_shared/security-proof.ts` (pure: parsers,
redaction, fingerprints, dedupe, proof), `_shared/security-proof-db.ts`,
`api/routes/security-proof.ts` (api-ext), `_shared/vuln-watch-db.ts`
(`ciReportFor`), migration `20261127140000_security_proof_release_kits.sql`,
`apps/admin/src/components/releases/SecurityProofPanel.tsx`, MCP
`get_security_proof`.

Related (part B): ADR 0017 (decision 3: every live connector action needs a
hash-matched, single-use, expiring human approval), part A (the proof a kit carries), ADR [0020](0020-local-ux-loop-runs-agents-in-the-cli-process.md)
and [0067](0067-ux-scorecard-scores-pages-on-a-written-rubric.md) (the UX
captures a kit copies), Plan 025 P1 (`ux_baselines`), P5, P6. Code:
`_shared/release-kit.ts`, `_shared/release-kit-db.ts`,
`api/routes/release-kits.ts` (api-ext), `_shared/connectors/store-media.ts`,
`_shared/connectors/app-store-connect.ts` and `play-console.ts` (act),
`packages/ux/src/clips.ts` (`mushi-ux clips`), migration
`20261127140000_security_proof_release_kits.sql`,
`apps/admin/src/components/releases/ReleaseKitBuilder.tsx` and
`StoreUploadCards.tsx`, MCP `export_release_kit` and
`request_store_media_upload`, hand-off contract
`docs/integrations/lazycow-release-kit.md`.

## Context

### A. Security proof

Plan 025 asks that a security scan prove each release. Mushi already reads
lockfiles itself (vuln-watch, ADR 0038), but has no secret scan, no
code review for security and no live-site scan, and nothing that ties a scan
to the commit a release ships.

The scanners worth running have licences a hosted service has to respect:

- OSV-Scanner (Apache-2.0), Gitleaks (MIT), ZAP (Apache-2.0), Nuclei (MIT) and
  Anthropic's `claude-code-security-review` (MIT) may be run by anyone.
- Semgrep's registry rules may not be offered as a service (Semgrep Rules
  License v1.0, since December 2024), and the opengrep rules carry a Commons
  Clause.
- `claude-code-security-review`'s README says it "is not hardened against
  prompt injection attacks and should only be used to review trusted PRs".

### B. Release kit and store media

Plan 025 asks that every release refresh the store screenshots and a product
video. Mushi already has before/after captures from UX runs (deleted after 30
days), release changelogs and the project's widget colours; it has no video
and only read access to App Store Connect. lazycow, a separate self-hosted
repo, renders reels with Remotion. Remotion is free for individuals and
companies of up to 3 people; bigger companies need a company licence.

ADR 0017 decision 2.2 (S-1) put store listings in the host repo, published
by the host's CI, with "at most a read-only key per store". Its decision 3
already allowed approved single actions, and the Play connector has carried a
write key for rollouts since Plan 020 Phase 4.

## Decision

### A. Security proof: scanners run in the founder's CI, Mushi reads the results

1. **The founder's CI runs every scanner; Mushi only reads results.** Mushi
   writes `mushi-security.yml` (copy it, or Mushi opens a PR that adds it,
   like `mushi-verify.yml`). Each job posts its SARIF or JSON to
   `POST /v1/security/results` with a project-bound key holding `mcp:write`.
   Mushi never runs a scanner, never bundles or hosts Semgrep registry rules
   or opengrep rules, and never holds the founder's model key.
2. **Lanes and cadence.** Every PR: OSV-Scanner (dependencies) and Gitleaks
   (secrets, `--redact`, filesystem mode). Opt-in (`MUSHI_SECURITY_AI_REVIEW`):
   the AI review with the founder's own `ANTHROPIC_API_KEY`. Weekly (a
   Monday cron) and on demand: ZAP baseline (passive) and Nuclei
   (`-etags intrusive,dos,fuzz,bruteforce`, 10 requests a second) against
   `MUSHI_STAGING_URL`. On demand, `workflow_dispatch` with `sha` proves one
   release commit; pushes to the default branch do not run it again (the PR
   already did).
3. **The AI review reads trusted authors' PRs only** (owner decision
   2026-11-27): `pull_request` (never `pull_request_target`), same-repo heads
   only, and the PR author in `MUSHI_SECURITY_TRUSTED_AUTHORS`, which
   defaults to the repo owner plus, when the deployment has one, its GitHub
   App bot (`<slug>[bot]`), so Mushi's own fix agents are covered. Forks and
   strangers never reach it.
4. **Findings are reports, deduped both ways, with no model call.** Each
   finding gets a fingerprint (dependencies: advisory + package; secrets and
   AI review: rule + file; DAST: rule + URL path). One open `security_scan`
   report per fingerprint (a partial unique index settles races). A
   dependency finding whose package and advisory vuln-watch already tracks
   links to vuln-watch's report; vuln-watch in turn links a group to an open
   `security_scan` report instead of filing again. Reports use fixed text
   (status `classified`, confidence 1), medium and above, at most
   `security_reports_daily_limit` (default 10) a day, most severe first.
5. **Nothing secret is stored.** Gitleaks runs with `--redact`; the server
   keeps only rule, severity, a one-line title, file and line or URL path
   (query strings dropped), and package; SARIF snippets, region text and
   tool fingerprints are never read, and every text passes a token-shaped
   redaction. Scanner and AI-review text is untrusted input
   (`get_security_proof` is `returnsUntrusted`).
6. **A release's Security proof is the scans for its commit.**
   `releases.commit_sha` pins the commit (auto-release sets it from the
   deploy or release webhook; a person or agent can set it). Per lane the
   newest run for that commit counts; DAST is weekly, so it counts when it
   ran within 8 days before the release, and older is `stale`.
   - `proven`: dependencies and secrets passed for the commit, and no
     enabled lane has findings, errors or a stale run.
   - `attention`: something found, or an optional lane errored or is stale.
   - `incomplete`: a required lane has no result for the commit. A lane that
     never ran is never a pass.
   - `not_pinned`: the release names no commit.
7. **Positioning is unchanged (ADR 0038).** The proof lives on the release
   (Releases → a release → Ship it) and in its kit manifest; no top-level
   Security page, no nav entry, and "security scanner" is not a category word.

### B. Release kits feed product videos; store media uploads are approved actions

8. **One kit per release** (`release_kits`, `release_kit_assets`, private
   bucket `release-kits`, 100 MB per object): before/after screenshots,
   clips, device recordings, the rendered video, the changelog lines (from
   the release's Markdown, editable), brand tokens (project name,
   `sdk_widget_accent`, `sdk_widget_theme`, overridable per kit) and a
   preset (`app_store_preview`, `play_promo`, `social_vertical`,
   `social_square`) with its output spec.
9. **Screenshots are copies.** The kit reads Plan 025 P1's `ux_baselines`
   (migration `20261127130000_ux_timeline.sql`: one capture per surface_key
   and viewport per release, matched by `release_id`, else by its `version`
   label; this release "after", the previous release "before") and, until that
   table exists, the newest `ux_surfaces` before/after thumbnails in the
   release's window, and copies them into `release-kits`, so the 30-day
   `ux-captures` sweep never empties a kit.
10. **Clips are opt-in and capped.** `mushi-ux clips` records Playwright
   `recordVideo` WebM clips of named flows (at most 5 flows of 6 screens,
   `release_kit_clip_max_seconds` default 30, at most 60;
   `release_kit_clip_max_mb` default 25, at most 100) only when
   `release_kit_clips_enabled` is on (default off). Native apps upload
   device recordings by hand. A WebM clip is source footage for the video
   tool, never a store preview by itself.
11. **Mushi never renders or transcodes video.** `export_release_kit` (MCP and
   `POST …/kit/export`) signs every ready asset for 24 hours, writes
   `manifest.json` in lazycow's own contract (`lazycow.release-kit` v1, its
   JSON Schema and type copied into this repo; every asset with its own
   absolute signed URL, size and SHA-256; Mushi's extras under `mushi`) and
   returns its signed URL as `kitUrl`. lazycow's `make_product_video({ kitUrl, preset })` renders on
   the founder's machine under the founder's Remotion licence and posts the
   file back as a `product_video` asset. Social posting stays in lazycow
   (`publish_reel`, approval first).
12. **Spec checks are honest.** Image sizes are measured from the file (PNG
   IHDR, JPEG SOF); video length, frame rate and codec are shown as
   `declared` because Mushi does not parse containers. Apple's preview rules
   (15–30 s, H.264 or ProRes 422 HQ, at most 30 fps, accepted resolutions
   such as 886×1920) and Play's image rules (320–3840 px, at most 2.3:1,
   feature graphic 1024×500, icon 512×512, no alpha) come from the vendors'
   pages read 2026-11-27.
13. **Store media uploads are connector actions, approved one by one
   (amends S-1).** App Store Connect gains `upload_screenshots` and
   `upload_app_preview`; Google Play gains `upload_listing_images` and
   `set_promo_video` (Play takes a YouTube URL, not a file). They run only
   through `executeConnectorAction`: an agent or teammate asks
   (`request_store_media_upload` / `POST …/kit/store-upload`), an owner or
   admin approves the exact payload in the console, and runs it once within
   the hour. The payload pins every asset by bucket path, size and SHA-256;
   `act()` downloads and re-hashes each asset before a byte leaves, and
   refuses on any change. Each store needs a separate write key (App Store:
   the App Manager role; Play: "Edit store listing"). Listing text stays
   listing-as-code, published by the host's CI.
   Running happens only on `POST …/kit/store-upload/:actionId/execute`
   (api-ext, console session, owner or admin), the one route that injects
   the uploaders (`_shared/connectors/store-media-act.ts`). The connectors
   declare the actions but delegate through `ctx.storeMedia`, and the
   generic `…/connector-actions/:id/execute` refuses them before claiming
   (`USE_RELEASE_KIT`), so the approval stays usable. This keeps the upload
   code out of the `api` function, which sits at its 4.54 MB deploy budget
   (scripts/deploy-edge-function.test.mjs). Approve and reject stay on the
   org routes.
14. **Not automatic yet.** Plan 025 lets these be promoted to automatic with
   `auto_release_enabled` later; this ADR does not. Until a superseding ADR,
   every store upload needs a person's approval.

### C. Follow-ups decided with the build (owner, 2026-11-27, "approved on all lines")

15. **High and critical CI security findings take the release train's
    express lane (amends ADR [0044](0044-release-trains-batch-approved-fixes.md)'s
    express list).** ADR 0044 lets "a fix for a `security_advisory` report or
    a critical bug" skip the train window. A fix for a `security_scan` report
    of high or critical severity now does too (`isExpress` in
    `_shared/merge-train.ts`). Medium and low ones still ride the train, and
    `security_advisory` keeps its express lane at any severity, as 0044 says.
    Nothing else about 0044 changes: an express fix still needs its review
    approval at its exact head (ADR 0041 / 0047) before it merges. ADR 0044
    does not forbid other express cases; it lists them, and this adds one.
16. **Readiness matches lazycow.** lazycow renders App Store previews from
    full-screen phone "after" screens alone, so a kit with a phone-shaped
    "after" screen (or a recording) is ready for the App Store preset;
    footage is shown as recommended, not required. The social and Play cuts
    also recommend "before" screens.
17. **Store uploads run from the release.** A request saves its `releaseId`
    in the payload; the team's action list (Portfolio → Store and payment
    actions) can approve or reject it and links "Run it from the release" to
    `/releases?release=<id>`, the drawer whose kit carries the uploader. It
    no longer offers store media actions under "Ask for an action".
18. **`mushi-ux clips` reads the app's caps before recording**
    (`GET …/kit` settings): it records within the lower of the asked and the
    app's caps, records nothing when the app has clips off, and falls back to
    the local caps when the server cannot be read (the server still enforces
    them on upload).

## Rejected alternatives

- **Run the scanners on Mushi's infrastructure.** It would put registry-rule
  licences, the founder's code and the founder's model key on Mushi's side,
  and Mushi's minutes on every customer PR.
- **Semgrep / opengrep rules as the SAST lane.** Their licences forbid
  offering them as a service; the AI review plus OSV and Gitleaks cover the
  vibe-coded failure modes without them.
- **Run the AI review on every PR.** Its README says it is not hardened
  against prompt injection; a stranger's PR could steer it.
- **Run on every push to the default branch too.** It re-proves what the PR
  proved and doubles the founder's minutes; `workflow_dispatch` with the
  release commit covers squash merges.
- **Store the SARIF as is.** Snippets can carry the very secret that was
  found.
- **Render the video in Mushi.** A hosted Remotion render farm would need a
  company licence on Mushi's side for every customer, and CPU-heavy render
  minutes Mushi pays for; Revideo (MIT) was the fallback if lazycow could
  not take P5.
- **Upload store media through the host's CI (fastlane `deliver`) only.**
  Kept as the founder's choice, but it means a PR per screenshot refresh;
  the approved action is the one-click path.
- **Keep kit screenshots as links into `ux-captures`.** The retention sweep
  would break exported kits after 30 days.
- **Trust a declared SHA-256 at upload time.** `act()` re-hashes what it
  downloads; the approval covers bytes, not a claim.

## Consequences

- A founder who never adds the workflow sees `incomplete` with a one-click PR,
  not a green badge.
- Gitleaks in filesystem mode checks the files at the commit, not every past
  commit; a secret added and removed inside one PR is not seen. Full-history
  scans stay a manual `gitleaks git` run.
- The template calls third-party container images by version tag
  (`ghcr.io/google/osv-scanner:v2.7.1`, `ghcr.io/gitleaks/gitleaks:v8.30.1`,
  `ghcr.io/zaproxy/zaproxy:2.17.0`, `projectdiscovery/nuclei:v3.11.1`) and the
  two actions by commit SHA; bumping them is a template change.
- Self-hosted runners need Docker and jq.
- An approved App Store upload downloads each file into the edge function's
  memory (at most 100 MB per asset, 3 previews or 10 screenshots per
  request). ProRes previews larger than that go through App Store Connect
  or fastlane.
- Apple marks the v1 asset-upload objects deprecated as of API 4.5 while the
  documented flow is still reserve, PUT, commit with an MD5; the connector
  follows the documented flow and is tested against fixtures only. It has
  never run against a live Apple account (no credentials in this change).
- Until P1's `ux_baselines` lands, kits are built from UX-run thumbnails,
  which may not line up with releases exactly.
