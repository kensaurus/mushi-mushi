# 0067. The UX scorecard: every page scored on a written rubric, problems filed by root cause

Status: Accepted 2026-11-21, accepted by the owner 2026-11-21. Built on the
owner's request of the same day; it moves the line ADRs 0020, 0021, 0045 and
0040 draw on model judgement. Date: 2026-11-21

Related: ADR [0045](0045-ux-audit-finds-bugs-on-signed-in-screens.md) (UX
audit), ADR [0020](0020-local-ux-loop-runs-agents-in-the-cli-process.md) and
[0021](0021-a-second-model-may-veto-a-kept-ux-step.md) (the loop and its
checker), ADR [0040](0040-site-audit-deterministic-live-site-checks.md) (site
audit), ADR [0039](0039-better-models-make-mushi-better.md) (facts in code,
judgement to the model), ADR [0065](0065-code-audit-root-cause-identity.md)
(one report per root cause), `_shared/ux-scorecard.ts` (kept byte-identical in
`packages/ux/src/scorecard-rubric.ts`), `_shared/ux-scorecard-io.ts`,
`api/routes/ux-scorecard.ts`, `packages/ux/src/scorecard.ts`,
`apps/admin/src/components/ux-runs/UxScorecardView.tsx`, migration
`20261121190000_ux_scorecard.sql`.

## Context

On 2026-11-21 an agent scored all 75 pages of Mushi's own console by hand, with
a 1–10 score per page, its top problems with fixes, and eleven root causes
that cut across pages. The two worst were a status the page contradicted (Checks
said "Not run yet" next to 7 of 7 passing tests) and raw machine values
("34865m old"). The owner asked: "isn't this kind of audit available in
mushimushi in the first place… mushi console should be able to do the above."

Mushi had the parts and no scorecard:

- `mushi-ux audit` (ADR 0045) captures signed-in pages and files measured
  defects. It drops every judgement that is not a concrete visual defect, so it
  cannot see a misleading status, jargon, a page that does not say what it is
  for, or two pages that disagree. It gives no score, keeps its findings on the
  machine and dedupes per page and rule.
- The site audit (ADR 0040) and the site watch read public pages through
  Firecrawl, without a browser.
- The UX loop's judge compares a screen before and after an edit.
- Nothing stored a page's score, so nothing could show a page getting better.

## Decision

1. **A written rubric of eight dimensions**, each scored 1–10 against the same
   five anchors: clarity, hierarchy and density, consistency with the app's own
   pages, states (loading, empty, error, locked), truthfulness (does the page
   claim what its own data contradicts, is the scope right), copy (raw values,
   jargon, tab title), accessibility and performance feel. The rubric and its
   anchors are in code (`UX_RUBRIC`, `UX_SCORE_ANCHORS`) and versioned
   (`UX_SCORECARD_PROMPT_VERSION`). No page of any app is named in the prompt.
2. **Facts in code, judgement to the model** (ADR 0039):
   - The capture records what a person meets: the browser tab title, the
     breadcrumb, headings, visible text (with banners and toasts outside the
     main content), controls, a screenshot at about one second and one once the
     page settles, the measured settle time, serious and critical axe results,
     sideways scroll and layout shift.
   - The settle time caps the performance score and the axe results cap the
     accessibility score (`performanceCap`, `accessibilityCap`).
   - The model scores each dimension and names at most five issues. Each issue
     quotes its evidence, names a fix and, when it likely comes from something
     shared, that shared root. It also lists the page's claims (statuses and
     counts) for the cross-page check.
   - The overall score is computed, not asked: 0.55 × mean + 0.45 × the worst
     dimension, so one misleading status drags a page down.
   - An answer missing a dimension is refused. An issue worded as taste, under
     0.5 confidence, or without evidence or a fix is dropped. Evidence is
     checked against the page's own text (`evidenceSeen`).
3. **Root causes across pages.** Code groups issues whose shared root names the
   same thing in the same dimension, or that quote the same evidence. One more
   model call per run, text only, merges reworded causes and finds
   contradictions between pages' claims. Its causes must cite issues or pages
   that exist.
4. **One report per root cause** (ADR 0065's shape):
   - A cause's identity is `pattern_key = ux:<dimension>:<slug>`. An earlier
     run's open key is reused when the cause names the same thing, so a
     rewording keeps its report.
   - The new source is `ux_scorecard`, a `check` source. It has its own partial
     unique index: one open report per (app, pattern key).
   - A run files at most 5 causes and an app holds at most 15 open ones. A
     cause is filed only when it spans pages, is a contradiction, or is high
     severity, and only with evidence seen on the page (or confidence 0.8 or
     more).
   - A cause whose key is already open only refreshes that report's
     `affected_screens`. Per-page issues stay on the scorecard.
5. **Where it runs.** `mushi-ux scorecard` captures on the person's machine,
   with the audit's cached signed-in profile and its read-only write guard. It
   never clicks; it only navigates.
   - `--score-via server` sends each page to `POST …/ux-scorecard/:run/score`.
     That call runs the app's own Claude or OpenAI key first, then the platform
     route `ux-scorecard` (tier standard) on kenji, through
     `withAnthropicOrOpenAi`. One request is one model call.
   - `claude-code`, `cursor` and `anthropic-api` score on the machine with the
     same module, for self-host and for runs before the server is deployed.
   - `--from-captures` scores captures another driver wrote in the same layout.
     Example: a page opened inside a browser session that is already signed in,
     where a second browser on the same profile would sign the owner out.
6. **Storage.** A run is a `ux_runs` row of kind `scorecard`. Each page is a
   `ux_surfaces` row with `score`, `scorecard` (the eight scores, the issues and
   the claims) and `facts`. A page's trend is its score across runs, by
   `(project_id, path)`, where path keeps the view
   (`scorecardPageKey`: `/team?view=sso` is its own page). The viewport is per
   app (`project_settings.ux_scorecard_viewport`, default `1440x900`:
   desktop-first; a phone-first app sets `390x844`).
7. **The console** shows it on `/ux-runs?view=scorecard`: pages worst first,
   with the trend, the weakest dimensions and the top problem; the root causes
   with their fix, their pages and the report each was filed as.

## How this squares with ADRs 0020, 0021, 0045 and 0040

Those ADRs keep taste out of what Mushi files. They cite Baymard's 80% error
rate for GPT-4 UX audits and UICrit's 13% of valid zero-shot critiques. This
ADR keeps that line for filing and moves it for scoring:

- A score is advisory and shown, never filed. A person reads it next to the
  evidence.
- What is filed is a root cause with quoted evidence, found on more than one
  page or as a contradiction, above a confidence floor. It is checked against
  the page's own text, and capped per run and per app.
- The measurements those ADRs rely on (axe, settle time, sideways scroll)
  still bound the scores they cover.
- The keep-or-revert decision of the UX loop (ADR 0020) is unchanged: no score
  here decides whether an edit is kept.

## Dogfood, 2026-11-21

The first run scored the Mushi console (desktop, 1440x900, the owner's
signed-in session, navigation only) and was compared page by page with the
hand-made scorecard. The numbers are in the PR, not here.

## Rejected

- **A new subsystem beside the UX tools.** The capture, the write guard, the
  cached profile, `ux_runs`/`ux_surfaces`, the upload bucket and ADR 0065's
  pattern keys already existed. The scorecard is a mode of them.
- **The model's own overall score.** Models cluster at 7–8. A page that lies
  about one status is not a 7.
- **One report per page or per issue.** The same scope banner on 45 pages
  would be 45 reports (ADR 0065's lesson).
- **Scoring in the edge function from a crawl.** An edge function cannot run a
  browser, and a crawl sees neither signed-in pages nor loading states.
- **Scoring from the screenshot alone.** Tab titles, raw values below the fold
  and text that changes while loading are invisible in one settled image.

## Consequences

- A run of N pages makes N + 1 model calls. A run of 60 pages on a standard
  route costs about as much as 60 report classifications with vision.
- The route rows for `ux-scorecard` (feature, tier standard, vision-capable
  models) must exist on kenji. Until they do, the baked standard list answers.
- A score depends on the model. The prompt version is stored with every page,
  so a trend across a prompt change says so.
- Scores of runs taken while an app was scoped differently (a different active
  app in the console) are not comparable page by page.
