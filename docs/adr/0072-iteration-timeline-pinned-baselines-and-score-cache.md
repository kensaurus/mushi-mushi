# 0072. The iteration timeline: pinned baselines per release, a verdict cache, and no agent-started cloud runs

Status: Accepted 2026-11-27 (owner, "approved on all lines"). Plan 025 phases
P0, P1, P7 and P8. Date: 2026-11-27

Related: Plan 025 (`docs/execplans/ecosystem-loop.md`), ADR
[0067](0067-ux-scorecard-scores-pages-on-a-written-rubric.md) (the scorecard),
ADR [0020](0020-local-ux-loop-runs-agents-in-the-cli-process.md) and
[0021](0021-a-second-model-may-veto-a-kept-ux-step.md) (the loop and its
review), ADR [0017](0017-strike-the-plan-019-020-sequencing-gate.md) (nothing
acts on its own), ADR [0039](0039-better-models-make-mushi-better.md), ADR
[0015](0015-use-kensaurus-gmail-as-the-product-support-inbox.md) (support
inbox), migration `20261127130000_ux_timeline.sql`, `_shared/ux-timeline.ts`,
`_shared/ux-score-cache.ts`, `api/routes/ux-timeline.ts`,
`apps/admin/src/pages/TimelinePage.tsx`.

## Context

Mushi showed one run at a time: before/after per screen and a 12-run score
sparkline. Screenshots are deleted after 30 days
(`project_settings.ux_capture_retention_days`), so nothing could show a
founder how a screen changed across releases. The scorecard (ADR 0067) also
paid one model call per page per run, even when the page had not changed, and
no run recorded what it cost.

## Decision

1. **Baselines are copies.** `ux_baselines` pins one screenshot per screen,
   viewport (desktop, mobile) and release or version label. The file is copied
   to `<project>/baselines/<screen>/<viewport>/…` in `ux-captures`, so the
   30-day capture sweep never deletes it. A row pointing at a run's own capture
   was rejected: that file is deleted with the run's captures.
2. **What gets pinned is what users have.** A scorecard page pins its settled
   shot. A loop screen pins its kept version only once the run's PR merged,
   else the original. A page is one screen across both kinds of run (keyed by
   its path); tabs, dialogs and menus keep the loop's key.
3. **Retention (owner decision 2026-11-27).** The newest
   `project_settings.ux_baseline_keep_releases` (default 24) per screen and
   viewport are kept; a row marked `pinned` is kept forever. The retention
   sweep deletes the file first, then the row; a failed file delete keeps the
   row for the next sweep.
4. **The rail.** The console's Timeline (`/timeline`, a Lab next to UX runs)
   uses the app's releases as points, plus "Unreleased" for later work. With no
   release rows (most founders) it falls back to the UX runs. Each point shows
   the reports it closed, the screens the loop improved, the newest scorecard
   mean and what its runs cost. No model call anywhere on the page.
5. **Pinning is a request, or opt-in on publish.** The console's "Pin
   current screens", `POST /timeline/baselines` and the CLI or MCP with an
   `mcp:write` key pin on request (at most 12 an hour per app). An app that
   switches on `project_settings.ux_baseline_auto_pin` (off by default) also
   pins when a release is published, through the same code
   (`_shared/ux-baseline-pin.ts`, called from `release-publish.ts`): at most
   240 copies, best effort, never failing the publish. A viewer sees Pin, Keep
   forever and the settings disabled with the reason, and a run links to the
   operator-only `/ux-runs` only for an operator.
6. **Score only what changed (P8).** The scorecard's `/score` takes a
   `shot_hash` (the CLI's 64-bit dHash of the settled shot). The key is sha256
   of the prompt version, the viewport, the page's text facts (title,
   breadcrumb, headings, text, controls, axe counts and rules, sideways
   scroll, whether the console had errors) and that hash. Text is in the key
   because the image hash does not see copy change, and truthfulness and copy
   are scored. Settle time and layout shift are out of the key; their caps are
   re-applied to the reused model numbers from today's facts. The lookup is
   per app, at most 30 days old, so a new model or rubric gets its turn (ADR
   0039); `rescore: true` forces a call. No shot hash, no cache: older CLIs
   are unchanged.
7. **The loop's review skips what it has seen.** The pairwise review (ADR
   0020) makes no call when the kept version looks the same as the original,
   and reuses a verdict for the exact same pair of images, model, rubric and
   design files from `.mushi/ux/judge-cache/`. It is advisory, so ADR 0021's
   checker is untouched.
8. **Cost per run.** Scorecard pages store `cost_usd` (0 when reused), and the
   run stores the total and `{ judged, cached, unpriced }`. The loop's CLI
   sends its review tokens (`judge_usage`, optional) and the server prices
   them with the price catalog (`priceLlmCall`). The Timeline shows cost per
   run, per release and for the month.
9. **`start_ux_run` does not start a run (decided).** ADR 0017/0020 let only
   a console session start a cloud run, because it spends the host's Actions
   minutes and Cursor credits. The MCP tool `start_ux_run` makes no change: it
   returns the console link (one click, by a person) and the exact local
   `mushi-ux` command, which runs on the caller's own machine and keys.
   Queueing a run for a local worker lane (as the first-time user test does,
   ADR 0053) was considered and not taken; it would need its own ADR.
10. **No product code path special-cases a tenant (P0).** Hosted-domain
    constants read one `MUSHI_PUBLIC_ORIGIN` setting with today's origin as
    the default, and the support inbox stays `kensaurus@gmail.com` (ADR 0015),
    read from one constant. Env-var names, the SDK snippet and the stack
    guess follow the app's detected framework, never its slug; the
    operator's own console is the project in `VITE_MUSHI_SELF_PROJECT_ID`.
    Favicons come from the app's own data (icon, repo, SDK origin) and the
    caller's shared hosts, not a per-app table. The content-quality callback
    reads `X-Mushi-Signature`; `X-Glotit-Signature` is accepted as a
    deprecated legacy name so live webhooks keep working.

## Consequences

- Storage grows by at most 2 × 24 shots per screen per app, plus pinned ones.
- A scorecard rerun of an unchanged app costs close to nothing; the first run
  after a rubric bump costs a full run.
- An agent can read the timeline and a screen's history (`get_timeline`,
  `get_surface_history`) and read a run (`get_ux_run`), but cannot spend
  Actions minutes or model credits on its own.

## Rejected

- Pointing baselines at run captures (deleted after 30 days).
- Keeping every baseline forever (unbounded storage; the owner chose 24).
- A dHash-only cache key (stale truthfulness and copy scores).
- An API-key path to `/ux-runs/cloud` (contradicts ADR 0017/0020).
