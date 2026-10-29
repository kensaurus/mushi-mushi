# Plan: simple on the outside, deep on the inside (2026-10-29)

Status: **plan only, for the owner to approve phase by phase.** Nothing here is built.
No code, settings or data were changed while writing it. Production was read with
read-only SQL on 2026-10-29 (Supabase project `dxptnwrhwsqckaftyymj`). Repo state:
`master` after PR #894.

The owner's brief, in one line: people drop off because Mushi Mushi shows its whole
machine at once. The fix is Japanese product design: two or three buttons on the
outside, a deep and swappable inside, and mistakes made impossible instead of warned
about. Try it first on the console's first-report and feedback loop, on yen-yen,
glot.it, Help Her Take Photo and the-wanting-mind.

## 0. Summary

- **Most of the inside already exists.** Mushi Mushi has more than 60 setup and
  health checks (§1d). They live under five names on five surfaces, so a new user never sees them
  in one place.
- **New users stall at one measured point.** Every outside key that ever checked
  in was last seen from localhost (3 of 3), and none sent a report.
- **Owners stall because one cause shows up as dozens of rows.** All four pilot apps
  have the same 3 setup gaps. More than half of their recent failed fixes have
  environment causes, not code causes.
- **The plan:**
  - one check list (the "Health check");
  - a cause that is broken stops whatever depends on it, and is shown once;
  - a first run with three buttons;
  - settings regrouped into swappable "parts";
  - a pilot that measures time to first diagnosis and the number of rows an owner
    must clear.

---

## 1. The problem in numbers

### 1a. What a new user faces today (counted in the repo)

| Surface | What is on it | Source |
|---|---|---|
| Landing | Hero with an install box: 4 editor tabs (Claude Code, Cursor, Lovable or Bolt, Other), each 3 steps. One secondary link (free live-site check). Below the hero are 12 more blocks: diagnosis scroll stage, Who it's for (3 cards), More than bug reports (6 cards), What it takes (3 bullets), open-source strip, pricing, founder note, What this is, glossary, FAQ, a "More" line with 8 links, closing CTA. | `apps/docs/content/index.mdx`, `apps/docs/lib/landing-copy.ts` |
| Quickstart docs | 17 pages | `apps/docs/content/quickstart/` |
| `npx mushi-mushi` wizard | 13 prompt sites. The browser sign-in path asks up to 9: framework, saved credentials, browser or manual, project, update existing env, inject, connect editor, **enable Rewards**, send a test report. | `packages/cli/src/init.ts` lines 156–1284 |
| Console routes | 77 `path=` routes, 108 page files | `apps/admin/src/App.tsx`, `pages/` |
| Sidebar | 10 core items (`CORE_NAV_PATHS`), "More pages", and 20 Labs | `lib/navRegistry.ts`, `lib/labs.ts` |
| Settings | 6 tabs. `project_settings` has **230 columns**. | `pages/SettingsPage.tsx`, `lib/settingsTabExplainer.ts`, production schema |
| Set up page | 5 tabs (Overview, More to connect, Test it, Install, Fix a problem) and 10 setup steps (3 required) | `pages/OnboardingPage.tsx`, `api/routes/activation-setup-builder.ts` |
| Home | 11 sections: setup checklist, first-report hero, quota, app card, health strip, Needs you, release, sitemap, week, activity, access, plus "How this works" | `pages/DashboardPage.tsx`, `components/home/*` |
| Report detail | About 21 buttons across the page and its components | `pages/ReportDetailPage.tsx`, `components/report-detail/*` |
| Reporter widget (what the app's users see) | 9 views: report, success, my reports, report detail, leaderboard, roadmap, account, cross-app reports, assistant | `packages/web/src/widget-helpers.ts` `WidgetStep` |
| SDK presets | 7: production-calm, beta-loud, internal-debug, manual-only, minimal, standard, full | `packages/core/src/presets.ts` |

**The steps today, from sign-up to a merged fix.** Counted from the code; decisions
and keys are what the user must choose or supply.

| Stage | Steps | Decisions | Keys or accounts needed |
|---|---|---|---|
| Sign-up → first diagnosis (synthetic) | 1 sign up, 2 name the project, 3 press "see your first diagnosis" | 1 (project name) | none (key minted for you) |
| → first real diagnosis | 4 install (editor prompt, `npx mushi-mushi` or script tag), 5 deploy with the env vars on the host or in CI, 6 a real user (or you) reports from the live app | up to 9 wizard prompts, plus choosing the editor or install path | an SDK key in the right place on the host |
| → first fix merged | 7 connect GitHub (App or PAT), 8 add a Cursor key or set up a local worker, 9 dispatch a fix, 10 AI review (needs a Claude key), 11 CI runs after an approved review, 12 queue or release train, 13 merge, 14 a deploy event so the reporter is told | agent choice, auto-fix on or off, follow-ups on or off, release mode | GitHub, Cursor (or a local worker), Anthropic |

The first-run wizard is already short. It has 2 steps: name the project, then press
one button to see a diagnosis of a synthetic report (`FirstDiagnosisScreen`, live
since 2026-09-22). The overload comes **after** that screen: the 5 tabs, the 10
steps, the 11 Home sections and the 230 settings.

### 1b. Where real sign-ups stopped (production, read 2026-10-29)

Accounts that are not operators and not synthetic:

| Step | Accounts |
|---|---|
| Signed up (ever) | 10 (4 in the last 90 days) |
| Created a project | 4 |
| Minted an SDK key | 4 |
| Key ever checked in | 3, **each last seen from `localhost`** (only the latest origin is stored) |
| First report | **0** |
| First fix | 0 |

One account minted 4 keys for the same project on 2026-07-01. 3 were never seen and
are now inactive. That looks like confusion about which key goes where.

**Caveats.**
- All of these sign-ups (2026-04-21 to 2026-07-01) came before today's two-step
  wizard (2026-09-22) and the single sidebar (2026-10-20). They show where the old
  path broke, not the current one.
- There is no measured number for the current path:
  - `product_events` on the Mushi Mushi project recorded `signup_completed` once in
    60 days;
  - most server events have no actor (`fix_merged` 212 rows, 0 actors);
  - Mushi Mushi's own first-time user test has run 5 times (3 failed, 2 done), and
    none of them recorded a `ttfv_seconds`.

Phase 0 fixes the measurement gap.

The point where people stop is clear all the same: **"works on my machine" never
became "live users can report"**. Today nothing in the console names that state.
`sdk-health` has `never_seen` and `stale`, but no "seen only on localhost".

### 1c. Owner overload on the four pilot apps (production, read 2026-10-29)

| | glot.it | Help Her Take Photo | the-wanting-mind | yen-yen |
|---|---|---|---|---|
| Reports (all time) | 197 | 124 | 86 | 110 |
| Reports in `fixing` | 80 | 45 | 41 | 30 |
| Open fix PRs (open or draft, not merged) | 88 | 47 | 41 | 31 |
| … latest review says do not merge (`hold`) | 33 | 17 | 15 | 3 |
| … review asked for changes (`fix_first`) | 24 | 10 | 7 | 8 |
| … review says merge, still open | 31 | 20 | 19 | 20 |
| Failed fix runs, last 30 days | 68 | 59 | 30 | 91 |
| Active SDK keys | 11 | 6 | 3 | 8 |
| Setup gaps open | 3 | 3 | 3 | 3 |

That is **207 open fix PRs across four apps**. The `hold` and `fix_first` counts for
glot.it (33 and 24) are close to the owner's Home (31 "do not merge", 24 "changes
asked"). The console's groups in `_shared/pipeline-view.ts` apply more conditions,
for example on drafts and CI state, so the raw counts here run slightly higher. My
"review says merge" column is wider than the console's "approved and green, not
queued" (16), because that group also needs green CI and no queue row.

**One cause, many rows.** All four apps, and Mushi Mushi itself, have the **same three
setup gaps**, last checked 2026-10-28 16:26 UTC:

1. `review_followup_key`: "Mushi turned review follow-ups off: the Cursor key chosen
   for review follow-ups was deleted." This leaves every `fix_first` PR with no agent
   making the changes.
2. `autofix_agent_key`: "Auto-fix is on, but no Cursor key can start an agent." No fix
   starts on its own.
3. `deploy_events`: no deploy seen in 15 days, so reporters are never told their fix
   is live.

These are the most common reasons a fix failed in the last 30 days, across the four
apps. The top 12 reasons cover 79 of the 248 failed runs:

| Reason (normalised) | Runs | Code or environment |
|---|---|---|
| Worker `git push` failed on the repo's lint or pre-push hooks | 28 | environment |
| Worker run reaped: no result within 90 min | 12 | environment |
| Cursor API 400 `usage_limit_exceeded` (on-demand usage off) | 11 | environment |
| Review refused: change only edits comments | 9 | code |
| Local agent timed out after 30 min without a change | 8 | agent |
| `Cursor run ERROR` | 3 | unknown |
| Commit hook `readme-counts` failed | 3 | environment |
| Cursor API 400: branch `main` not found in repo | 3 | environment |
| Agent says it needs a person | 2 | code |

At least **57 of those 79** come from the environment: a hook, a key, a branch name or a
worker. Each one fails again on every fix until someone notices. In Toyota's terms
the line keeps running and makes the same defect. Section 2, P4 covers this.

### 1d. The checks that already exist (the inside is mostly built)

| Checker | Checks | Where a user sees it | File |
|---|---|---|---|
| Setup gaps | 5: `github_access`, `review_followup_key`, `autofix_agent_key`, `deploy_events`, `slack_bot_token` | Only on `/onboarding`, the Set up page (`SetupGapsSection`), and not on Home | `_shared/setup-gaps.ts`, `api/routes/setup-gaps.ts` |
| SDK health | 8 problems, each with a fix: `no_repo`, `not_installed`, `ci_secrets_missing`, `no_sdk_key`, `never_seen`, `outdated`, `csp_blocks_api`, `stale` (+ notes) | Connect, SDK health | `_shared/sdk-health.ts`, `api/routes/sdk-health.ts` |
| SDK diagnostics | Verdicts `banner-disabled`, `ci-secret-missing`, `native-never-seen`, `healthy`, plus CI secret auto-write | Connect, Native app CI secrets | `_shared/sdk-diagnostics.ts` |
| Server doctor | `recovery_token`, `recovery_cron`, `stranded_reports`, `dead_letter`, `codebase_index`, `observability`, `platform_*` | Health page, `mushi doctor --server` | `api/routes/doctor.ts` |
| CLI doctor | About 40: config, key, endpoint reachable, clock, credentials, SDK in repo, env vars, MCP config, Capacitor, hash router, SDK version drift, … | Terminal only | `packages/cli/src/doctor.ts` |
| Pipeline problems | `review_no_key`, worker findings, FixOpeners | `/pipeline`, Home "Needs you" (as pipeline groups, one row per group) | `_shared/pipeline-view.ts`, `_shared/project-home.ts` |
| MCP `diagnose_setup` | Setup mode guidance for the editor | Editor | `functions/mcp` |

Rough total: 5 + 8 + 4 + 7 + about 40 + the pipeline and worker flags (11 in
`_shared/work-flags.ts`, including `hook_failures`) gives more than 60 checks.

`AGENTS.md` documents an `endpointMatches` field in the SDK diagnostics response. I
did not find it in server code (grep, 2026-10-29). **Unverified:** an endpoint
mismatch check may not exist on the server today.

---

## 2. Principles

Every source was read on 2026-10-29 unless it is marked **unverified** (seen only in
a search snippet, or the fetch failed). Firecrawl was down, so the sources came from
WebSearch and WebFetch.

**P1. "This will do", not "this is what I want" (Muji, Kenya Hara).**
- What it means: a screen gives exactly what is needed and leaves room for the user's
  own use. Hara says this "emptiness" is not the same as minimalism.
- For Mushi Mushi: each surface offers the one thing that is enough for this moment,
  for example "see a diagnosis", not "configure your pipeline".
- Sources: Metropolis on Hara's *Designing Design* ("Muji products are supposed to
  inspire 'acceptance,' not 'appetite.'") [S1]; Dezeen interview with Hara, 2017
  ("Muji's path is different from simplicity") [S2]; muji.com "What is MUJI?"
  [S3, unverified].
- Use the wording "This will do". The "this is enough" phrasing is not verified.

**P2. Without thought, super normal (Naoto Fukasawa).**
- What it means: the default action is the one the user would take anyway, so the
  design disappears into use.
- For Mushi Mushi: no decisions before the first diagnosis. Defaults are chosen by
  detection (framework, editor, default branch, host), never by a question.
- Source: "When people use an object without even noticing it has been designed, it
  is truly fulfilling its function." [S4]

**P3. Poka-yoke: prevent the mistake, and warn only when you cannot prevent it
(Shigeo Shingo, Toyota).**
- What it means: Shingo described two types and held the control type to be the
  stronger:
  - control type: "the device actually prevents the mistake from being made";
  - warning type: the operator is alerted.
- For Mushi Mushi, settings that cannot be saved in a broken state:
  - auto-fix cannot be on with no usable key;
  - a key cannot be pasted where its scope does not fit;
  - the branch field cannot name a branch that does not exist.
- Source: [S5]. This is secondary (Wikipedia, citing Shingo and Dillon 1989). I
  found no Toyota primary page on poka-yoke itself.

**P4. Jidoka: stop at the first abnormality and fix the cause once (Toyota
Production System).**
- What it means: stopping "immediately when abnormalities are detected… eliminates
  the outflow of defective products". The cause is then fixed so it "cannot recur".
- For Mushi Mushi: a broken key, hook or branch pauses the automation that depends
  on it. It shows as one row. It never fails again on every fix (§1c: at least 57
  repeated environment failures).
- Source: [S6] (primary).

**P5. Progressive disclosure: the core first, the rest one layer down (NN/g).**
- What it means: progressive disclosure "defers advanced or rarely used features to
  a secondary screen". This makes applications "easier to learn and less
  error-prone". Staged disclosure applies the same idea to a sequence, where "each
  step is simple and its purpose is clear".
- For Mushi Mushi: the three-state Set up card, the parts' "Advanced" sections, and
  Home's "Details".
- Sources: [S7]. The console's own `lib/mode.ts` already cites Nielsen for "split
  tasks by frequency, not people by skill".

**P6. Fewer choices, faster decisions (Hick's law, choice overload, cognitive load;
NN/g).**
- What it means:
  - "the more choices you present to your users, the longer it takes them to reach a
    decision" [S8];
  - "having fewer options makes it easier for people to make a selection" [S9];
  - "User attention is a precious resource" [S10].
- Baymard's checkout research found that the number of fields matters "far more than
  the number of steps" [S11]. That is e-commerce data, not dev-tool data. The lesson
  that carries over is to count decisions, not screens.
- For Mushi Mushi: the pilot counts decisions before the first diagnosis.

**P7. Defaults do the configuring; no up-front tour (NN/g).**
- What it means:
  - "people tend to stick to the defaults", and "default values help reduce errors"
    [S12];
  - tutorials "interrupt users… and are quickly forgotten", so give help in context
    [S13];
  - up-front instructions "should be avoided as much as possible" [S14].
- For Mushi Mushi: the 230 settings get safe defaults. "How this works" appears only
  when it is needed.

**P8. Parts on one standard interface, easy to swap and repair (Muji storage
module, mottainai).**
- What it means: Muji sizes its storage to one grid, so boxes, drawers and shelves
  from different lines fit together and can be added later [S15]. Mottainai values
  objects "crafted to be re-sharpened and repaired" [S16].
- For Mushi Mushi: every part has the same four lines (status, what it does,
  Change, Turn off). Repair is a normal state ("Fix these first"), not an error page.

**P9. Design for the hardest case and it helps everyone (Japanese universal
design).**
- What it means: Kao's shampoo-bottle notches let anyone tell shampoo from
  conditioner by touch. They were made for blind users, help everyone ("most of us
  close our eyes when lathering up"), and became the standard JIS S 0021 [S17].
  TOTO's five principles of universal design include "able to choose" alongside
  "simple operation" [S18, list unverified].
- For Mushi Mushi: status is shown as words, not only as colour. Plain language
  throughout. The person with no terminal (Lovable or Bolt) gets the same three
  buttons.

**What strong dev tools do (exemplars).**

| Tool | What it does for the new user | Source |
|---|---|---|
| Sentry wizard | One command. It installs the SDK, writes the config files, keeps the token out of git, and creates a sample page with a "Throw Sample Error" button to prove it works. It does not add the feedback widget. | [S19] |
| PostHog AI wizard | Signs in, scans the code, writes env and events, and can open a PR to review instead of editing silently. | [S20] |
| Vercel | "automatically detects your project's framework and sets the best settings", and every setting can be overridden. | [S21] |
| Clerk | With no account, it "provisions a claimable application, writes dev keys to `.env.local`". Signing in later claims it. | [S22] |
| Resend | Shows a domain status (`pending`, `verified`, `partially_failed`, …) and adds DNS records with one click (Domain Connect). | [S23] |
| Expo, React Native doctor | Find problems, then fix them (`expo install --fix`) or give "a helpful link". `brew doctor` only reports. | [S24] |

Mushi Mushi already copies the Sentry and PostHog wizard pattern (`init.ts` header).
What it lacks is Resend's status-per-check and Expo's `--fix`. That is the Health
check in §4b.

### 2.1 Sources (all read 2026-10-29 unless marked)

- [S1] https://metropolismag.com/projects/kenya-hara-breaks-down-muji-unique-appeal/
- [S2] https://www.dezeen.com/2017/12/13/kenya-hara-exclusive-interview-muji-us-expansion-brand-aesthetic/
- [S3] https://www.muji.com/ph/feature/whatismuji/ (unverified: fetch timed out, search snippet only)
- [S4] https://www.german-design-council.de/en/design-perspectives/article-detail/when-design-disappears
- [S5] https://en.wikipedia.org/wiki/Poka-yoke (secondary source)
- [S6] https://global.toyota/en/company/vision-and-philosophy/production-system/
- [S7] https://www.nngroup.com/articles/progressive-disclosure/
- [S8] https://www.nngroup.com/videos/hicks-law-long-menus/
- [S9] https://www.nngroup.com/articles/simplicity-vs-choice/
- [S10] https://www.nngroup.com/articles/minimize-cognitive-load/
- [S11] https://baymard.com/blog/checkout-flow-average-form-fields
- [S12] https://www.nngroup.com/articles/the-power-of-defaults/
- [S13] https://www.nngroup.com/articles/onboarding-tutorials/ and https://www.nngroup.com/articles/mobile-app-onboarding/
- [S14] https://www.nngroup.com/videos/onboarding-skip-it-when-possible/
- [S15] https://www.dezeen.com/2020/03/13/muji-storage-solutions/
- [S16] https://www.japan.travel/en/responsible-travel-guide/features/mottainai-mindful-consumption/
- [S17] https://www.kao.com/global/en/sustainability/me/universal-design/shampoo-notches/
- [S18] https://jp.toto.com/en/company/csr/universal_design/ (the page confirms "Five Principles"; the list itself is unverified)
- [S19] https://docs.sentry.io/platforms/javascript/guides/nextjs/
- [S20] https://posthog.com/docs/ai-engineering/ai-wizard.md
- [S21] https://vercel.com/docs/builds/configure-a-build
- [S22] https://clerk.com/docs/nextjs/getting-started/quickstart.md and https://clerk.com/blog/accountless-setup-clerk-init-nextjs.md
- [S23] https://resend.com/docs/dashboard/domains/manage-domains.md and https://resend.com/changelog/new-domains-workflow.md
- [S24] https://docs.expo.dev/develop/tools/, https://docs.expo.dev/more/expo-cli/, https://reactnative.dev/blog/2019/11/18/react-native-doctor, https://docs.brew.sh/Manpage

Not verified and not relied on:
- Panasonic's six universal-design principles (HTTP 403);
- the Userpilot checklist-completion benchmark (vendor figure, 404);
- the Appcues 2% to 25% checklist anecdote (vendor);
- Resend's first-screen test email.

---

## 3. The outside: two or three buttons

House rule for every surface below: **one primary button, at most two others, and
everything else behind one "More" or "Parts" control.** Proposed copy always says
"Mushi Mushi", never "Mushi" alone.

### 3a. Landing (ADR 0052 already holds the outside to one action and one link)

The landing already has the right shape at the top: one install box and one
secondary link, enforced by `lib/landing-cinematic.test.ts`. Do not add buttons. Three
changes:

1. **Promise the self-check where the install happens.** Add one line under the
   install box: "Mushi Mushi checks its own setup and fixes what it can: the wrong
   key, the wrong address, a site that blocks it." Ship this line only once the
   Phase 1 and 2 checks exist, so the claim stays true.
2. **Make the setup prompt end at "live", not at "localhost".**
   `LANDING_SETUP_PROMPT` ends with a test report today. Add one last instruction:
   "then run `npx mushi-mushi doctor --live` after you deploy." This is a new flag
   that runs the go-live checks in §4b. If the prompt cannot run it (Lovable or
   Bolt), the console shows the same check (§3b).
3. **Owner decision, not baked in: the 9 cards under "How it works".** Today's ADR
   0052 amendment added Who it's for (3) and More than bug reports (6). The brief
   argues that overload causes drop-off. Two options:
   - **A. Keep both grids** as the amendment says.
   - **B. Collapse both into one line each**, six names with no descriptions, each
     linking to its docs section. Measure scroll depth and install-box clicks for 2
     weeks against A.

   B reverses part of an amendment the owner made today, so it needs a superseding
   note in ADR 0052. I recommend B only as a measured test.

```
+--------------------------------------------------------------+
|  THE BUG MEDIATOR FOR AI-BUILT APPS                          |
|  Your AI wrote it. Mushi Mushi tells you why it broke.       |
|  A user says your app is broken. ... No Sentry needed.       |
|                                                              |
|  Install with: [Claude Code] [Cursor] [Lovable/Bolt] [Other] |
|  +--------------------------------------------------------+  |
|  | 1 Connect   [ Copy command ]                           |  |
|  | 2 Paste this prompt   [ Copy prompt ]                  |  |
|  | 3 Fix a real bug: "Get the latest Mushi report..."     |  |
|  +--------------------------------------------------------+  |
|  Mushi Mushi checks its own setup and fixes what it can.     |
|  Not ready to install?  Check your live site free ->         |
+--------------------------------------------------------------+
   How it works (3 steps)  ·  Proof  ·  FAQ  ·  More ->
```

### 3b. First run in the console: three buttons

The current wizard stops after the synthetic diagnosis and then shows 5 tabs. The
proposal replaces the tabs with one card that has three states. Each state has one
primary button.

```
+---------------------------------------------------------------+
| Set up  ·  my-app                         Health check: 2 to fix |
|                                                               |
|  (1) See it work          (2) Add to my app      (3) Go live   |
|      [done ✓]                 [ Copy prompt ]        [ Check ]  |
|                                                               |
|  Status: seen from localhost <n> min ago ✓                     |
|          not seen from a live site yet                         |
|                                                               |
|  Next: deploy your app, then press Check.                     |
|  Mushi Mushi will look for: the 2 env vars on your host,       |
|  your site's security policy, and the right key type.         |
|                                                               |
|  More: script tag · other editors · keys · optional tools  v  |
+---------------------------------------------------------------+
```

- **(1) See it work** is today's `FirstDiagnosisScreen`: one button, a synthetic
  report, a diagnosis on screen.
- **(2) Add to my app** gives one box. It holds the prompt for the editor the user
  picked on the landing (remembered through `?src=`), or the script tag for Lovable
  or Bolt. A live status line under it reads from key heartbeats.
- **(3) Go live** runs the go-live checks (§4b, rows 1–5). It turns green only when
  the key has been seen from a non-localhost origin, or from a native client, and a
  first real report has come in.
- Everything in today's other tabs (More to connect, Install, Fix a problem) and the
  7 optional setup steps moves behind **More**. They stay reachable by URL, so the
  `?tab=` links keep working.

### 3b-2. Home for an owner with live apps: three zones

```
+---------------------------------------------------------------+
| glot.it                                                        |
|                                                               |
|  FIX THESE FIRST (root causes, max 3)                         |
|  ! No Cursor key can start a fix. <N> fixes are waiting.      |
|      [ Pick a key ]                                           |
|  ! Review follow-ups are off (their key was deleted).         |
|    <N> PRs wait for changes.        [ Use key "<name>" ]      |
|  ! No deploy seen for 15 days. Reporters are not told.        |
|      [ Connect deploys ]                                      |
|                                                               |
|  BUGS WAITING FOR YOU   <n> new · <n> critical   [ Open ]     |
|  SHIPPED THIS WEEK      <n> fixes merged · <n> deploys        |
|                                                               |
|  Details: health strip · sitemap · activity · access · week v |
+---------------------------------------------------------------+
```

- Wireframe values in angle brackets are placeholders, not measurements. The three
  gaps shown are the real ones open on glot.it on 2026-10-28. How many items each
  one blocks has not been counted per cause yet; Phase 1 adds that count.
- "Fix these first" is the Health check (§4b), grouped by cause, at most 3 rows,
  ranked by how many items each cause blocks. The pipeline's per-group rows (hold,
  fix_first, not_queued, agent_failed) appear only when no root cause explains them.
- The other 8 Home sections fold under **Details**, which opens by default only once
  the app has a week of data.

### 3c. The first-time user test and the feedback loop

**First-time user test (`/first-user-test`).** It has one button today, "Run now".
Without a local worker the button answers 409 `NO_WORKER`. The proposal:

```
+---------------------------------------------------------------+
| Would a stranger get through glot.it?                          |
|  Start: https://kensaur.us/glot-it   Goal: sign up and start  |
|                                          [ Try it as a stranger ] |
|                                                               |
|  Last test (<date>): got through in <m> min <s> s, <n> steps  |
|  Stuck once: <screen> needs <thing> (filed as a report)       |
|                                                       More v  |
+---------------------------------------------------------------+
```

- If no worker can take the run, the button becomes **"Set up this computer"** with a
  copy button for `mushi worker install`, and stays one button.
- The result is three lines: whether it got through, where it got stuck, and the
  time. The timeline, screenshots, visitor count and dry-run option move behind More.
- A hosted runner is not proposed. ADR 0053 calls it a separate decision.

**The reporter's loop (inside yen-yen, glot.it, Help Her Take Photo, the-wanting-mind).**
The widget has 9 views. The outside should be:

```
[ Report a problem ]
   -> "What went wrong?" [ text box ]   (screenshot attached, [remove])
   -> [ Send ]
   -> "Thanks. We'll tell you here when it's fixed."
```

- Leaderboard, roadmap, rewards, cross-app reports and the assistant stay available.
  They are off in the default `standard` preset and appear behind a "More" link only
  when the app owner turns them on.
- The visible presets become 3 (Calm, Standard, Loud). The other 4 stay as names in
  code and docs.
- The CLI drops the "Enable Mushi Rewards?" prompt from `init`. Rewards are turned on
  from the console.

**The owner's loop (report → fix → merged).** Report detail keeps one primary button,
**"Fix it"**:

- It uses the default agent when a dispatchable key exists and the repo's default
  branch is known.
- Otherwise it becomes **"Copy fix prompt"**. That needs no key and works in any
  editor.

It is never a button that fails after a click. The other fix choices (agent picker,
skill pipelines, research) sit behind More.

---

## 4. The inside: parts that can be swapped, checked and repaired

### 4a. The parts layer (where today's settings move)

The 230 settings columns and 6 tabs regroup into **parts**. Every part has the same
four lines, the same shape everywhere:

```
[status light]  Fix agent: Cursor (key "<name>")
                Opens fix PRs for reports you approve.
                [ Change ]  [ Turn off ]          Advanced v
```

| Part | What it holds today | Default for a new app |
|---|---|---|
| Report button | widget preset, screenshot, launcher, banner, assistant, rewards | Standard preset, screenshot on report, assistant off, rewards off |
| AI keys | BYOK pool (Anthropic, OpenAI, OpenRouter, Cursor, Firecrawl, Browserbase), sharing, spend-down | Mushi Mushi's hosted AI (no key needed) |
| Fix agent | Cursor, Claude Code (local worker), GitHub agent, copy prompt; auto-fix; follow-ups | Copy prompt (no key). Auto-fix off until a key passes its check. |
| Code host | GitHub App or PAT, default branch, fix branch | GitHub App; branch read from the repo |
| Alerts | Slack, Discord, Teams, Telegram, email | Email only |
| Error feeds | Sentry, Crashlytics, Rollbar, Bugsnag, Datadog | None (standalone first, VISION §1.7) |
| Releases | deploy events, release trains, merge queue, verified merge | Off until deploys are seen |
| Checks | site watch, first-time user test, audits, QA stories, CI cost | Site watch on the app's URL only |
| Spending | caps, credits, plan | Free-plan limits |

Each part's Advanced section holds today's fields unchanged, so nothing is removed.
Labs (`lib/labs.ts`) stay as they are.

### 4b. One Health check (consolidate, then add what is missing)

Build one check registry with one id per check. Each check knows four things:

- what it detects;
- its fix, in one of three forms: **auto** (Mushi Mushi does it), **one click** (a
  button), or **guided** (exact steps);
- which automations it **blocks** (`blocks: ['autofix', 'followups', 'train',
  'reporter_updates']`);
- the parts it belongs to.

Home's "Fix these first", the Set up card, `mushi doctor` and MCP `diagnose_setup`
all render the same list.

**Stop the line.** A red check that blocks an automation pauses that automation for
the app. Every item it would have failed collapses into the check's own row ("<N>
fixes are waiting on this"). When the check turns green, the paused work resumes on
its own. This is jidoka, P4. It replaces today's pattern, where each fix fails, files
an error and adds a pipeline row.

| # | Check id | Exists? | Detects | Fix | Blocks |
|---|---|---|---|---|---|
| 1 | `sdk_localhost_only` | **new**. Needs per-origin first and last seen: today `project_api_keys.last_seen_origin` keeps only the latest origin, so "never live" cannot be proven and a later localhost ping would hide a live check-in. | Key seen only from localhost or 127.0.0.1 for over 24 h, never from a live origin or native client | One click: show the env block for the detected host (`hostingEnvHint` in CLI) or write CI secrets (`sync-ci-secrets` exists) | first report |
| 2 | `never_seen` | yes (sdk-health) | Key minted, no check-in | One click: "Send a test bug from my browser" plus install task | — |
| 3 | `wrong_key_type` | partly (CLI `describeUnsafeSdkKey`) | A secret or MCP key in browser code, or a report-only key in the MCP config | Auto: mint the right scoped key and show the swap | — |
| 4 | `endpoint_mismatch` | **unverified**: in CLI doctor as "Endpoint reachable", documented in AGENTS.md, not found in server code | SDK posts to a different endpoint than the project's | One click: corrected env line | first report |
| 5 | `csp_blocks_api` | yes | Live site's CSP blocks the API | One click: file CSP task (exists) | first report |
| 6 | `banner_disabled` | yes (diagnostics) | Launcher hidden, so users cannot report | One click: turn the launcher on | reports |
| 7 | `no_report_7d` | **new** (extends `stale`) | Live and checking in, but no report for 7 days | One click: send a test from the live site, check the trigger is reachable | — |
| 8 | `ci_secrets_missing` | yes | Native or CI builds lack the env vars | One click: write CI secrets, or guided `gh secret set` | native reports |
| 9 | `key_sprawl` | **new** | More than 3 active SDK keys, or keys never seen for 14 days (glot.it has 11) | One click: deactivate unused keys, listed by last seen | — |
| 10 | `github_access` | yes (setup-gaps) | App or PAT missing a needed ability | One click: reinstall or re-consent | autofix, train |
| 11 | `autofix_agent_key` | yes | Auto-fix on, no key can start an agent | One click: pick a key. Poka-yoke: auto-fix cannot be switched on without one. | autofix |
| 12 | `cursor_on_demand_off` | partly: spend-down marks a refused key `exhausted_until` for 6 h and moves on; nothing tells the owner, and other dispatchers still fail (11 failures) | Cursor API answers `usage_limit_exceeded` | Guided: link to the Cursor setting; probe again | autofix |
| 13 | `review_followup_key` | yes | Follow-up key deleted | Auto: if exactly one valid Cursor key exists, choose it and say so; else one click | followups |
| 14 | `default_branch_mismatch` | **new** (3 failures) | Fix branch or base is `main`, but the repo's default branch differs | Auto: read the default branch from GitHub and save it | autofix |
| 15 | `worker_hooks_fail` | partly: `_shared/work-flags.ts` raises `hook_failures` after the fact; no check before the first run (31 failures) | The repo's commit or pre-push hooks fail inside the worker (missing tool, lint not set up) | Guided: run the hook once at `mushi worker install`, show the failing command and the missing tool. Never skip or bypass hooks. | that lane |
| 16 | `worker_stalled` | partly (pipeline worker findings) | Runs reaped after 90 min, or agent timeouts | One click: pause the lane, open Workers | that lane |
| 17 | `deploy_events` | yes | No deploy event in 14 days | One click: connect GitHub deployments or the deploy webhook | reporter updates |
| 18 | `slack_bot_token` | yes | Slack rejects the token | One click: reconnect | Slack alerts |
| 19 | `outdated_sdk` | yes | SDK behind latest | One click: upgrade PR (exists) | — |
| 20 | `review_no_key` | yes (pipeline) | Reviews skipped, no Claude key | One click: AI keys part | review, train |
| 21 | `stuck_fixing` | **new** (data) | Reports in `fixing` for over 7 days with no live attempt (glot.it 80, HHTP 45, TWM 41, yen-yen 30, some of these older than 7 days) | One click: return them to "ready to fix", or close the ones whose PR merged | — |
| 22 | `stale_open_prs` | **new** (data) | Fix PRs with a `hold` verdict, open over 14 days | One click: close them with a comment, keeping the report open | — |
| 23 | `duplicate_projects` | **new** | Two projects with the same repo URL or the same live origin | Guided: merge or archive | — |
| 24 | `stranded_reports`, `dead_letter` | yes (server doctor) | Pipeline stuck | One click: requeue | triage |

Checks 21 and 22 change data on the owner's request. They need a confirm step, and
for production data, the owner's explicit yes, as the repo rules require.

**Poka-yoke, not warnings.** Where possible, make the bad state impossible to save:
- auto-fix cannot be on without a dispatchable key;
- deleting a key that a part uses asks for its replacement in the same dialog;
- a report-only key cannot be pasted into the MCP config field;
- the fix branch field is filled from the repo and cannot name a branch that does
  not exist.

---

## 5. Pilot: yen-yen, glot.it, Help Her Take Photo, the-wanting-mind

The pilot measures two things separately, because they are different users.

### Track A: the new-user path (Mushi Mushi's own front door)

- **Tool.** The first-time user test on Mushi Mushi's landing, with synthetic accounts
  (ADR 0053). Only the Mushi Mushi project may mint them. Add the terminal-setup runner
  for the `npx` path.
- **First, fix the runs.** Mushi Mushi's 5 runs so far have no `ttfv_seconds`. Find
  out why: 3 failed, and the 2 done runs may have had capped waits.
- **Measure:**
  - `fresh_eyes.ttfv_seconds` (app time to the first diagnosis on screen);
  - `fresh_eyes.steps`;
  - number of decisions (choices plus fields) before the first diagnosis;
  - where it stalled.

  Take 3 visitors per run, at the baseline, after Phase 1 and after Phase 3.
- **Target.** First diagnosis within 3 minutes of app time and 8 steps or fewer, with
  0 decisions before it beyond the project name.

### Track B: the owner path on the four apps

| App | What it is (from key origins) | First-time user test? | Reporter loop test |
|---|---|---|---|
| glot.it | Web app at `kensaur.us/glot-it` (crawler URL and site watch set) | Yes. It stops at the sign-up wall unless the app's own test account is passed (`MUSHI_FRESH_EYES_EMAIL`/`_PASSWORD`). | Widget on the live web app |
| the-wanting-mind | Web at `kensaur.us/the-wanting-mind` (site watch, 101 pages) | Yes, same limits | Widget on the live web app |
| yen-yen | Native app plus a web page at `kensaur.us/yen-yen` | Web page only | Emulator (mobile-emulator-test), report from inside the app |
| Help Her Take Photo | Native app plus a web page at `kensaur.us/help-her-take-photo` | Web page only | Emulator (the `hhtp_test` AVD exists) |

**Measure on each app.** Take a baseline now, then again after each phase.

| Measure | How | Baseline (2026-10-29) |
|---|---|---|
| Rows in "Needs you" vs distinct root causes | `/v1/admin/projects/:id/home` plus the Health check | 3 shared root causes on every app |
| Open fix PRs | `fix_attempts` open or draft | 88 / 47 / 41 / 31 |
| Failed fixes from the environment, 30 days | failure reasons grouped as in §1c | at least 57 of the 79 runs in the top 12 reasons (248 failed in all) |
| Reports in `fixing` over 7 days | `reports.status` and attempt age | up to 80 / 45 / 41 / 30 |
| Clicks and minutes to clear the root causes | owner session, timed | not measured |
| Reporter loop: taps to send, time to diagnosis, reporter told "fixed" | widget on the live build or emulator, 1 report per app | not measured |
| First-time user test result | `ux_runs` with `kind = 'fresh_eyes'` | 0 runs on these 4 apps |

**Pass for the pilot:**
- each app shows 3 or fewer "Fix these first" rows;
- the environment failures from §1c stop repeating, because each cause pauses its
  automation after its first failure;
- a reporter on each app can send a report in 3 taps or fewer and sees its status.

---

## 6. Phased burndown

Each phase is separate. Approve one at a time. Release in one batch per phase (CI cost
rule 7).

**Phase 0: measure (prerequisite, small).**
- Give every server-side funnel event an actor.
- Add the missing steps: `sdk_seen_localhost`, `sdk_seen_live`,
  `first_real_report`, `first_diagnosis_viewed`, `first_fix_dispatched`,
  `first_fix_merged`.
- Files: `apps/admin/src/lib/track.ts`, the ingest heartbeat path in
  `api/helpers.ts`, `_shared` funnel RPCs (migrations `20260921000002_company_funnel_rpc.sql`
  family), `scripts/` funnel report.
- Risk: double counting with the existing `first_report_received`. Reuse its
  name where it fits.

**Phase 1: one Health check plus stop the line.**
- New `_shared/health-checks.ts`: a pure registry of ids, `blocks`, fixes and
  parts. Its first members are the existing checks from `setup-gaps.ts`,
  `sdk-health.ts`, `sdk-diagnostics.ts` and `api/routes/doctor.ts`.
- One route serves it. `api/routes/setup-gaps.ts` becomes a view of it.
- `_shared/project-home.ts` puts root causes first in Needs you.
- `_shared/pipeline-view.ts` tags each stuck group with the root cause that
  explains it.
- `fix-worker`, the review follow-ups and the release train check `blocks`
  before they start work.
- `components/home/NeedsYouCard.tsx` gets "Fix these first", and
  `SetupGapsSection` moves to Home.
- CLI `doctor.ts` and MCP `diagnose_setup` read the same registry.
- Risks:
  - Pausing automation by mistake. Mitigation: a check that cannot be read is
    `unknown` and never pauses anything, as `setup-gaps.ts` already does.
  - The merge queue and review gate rules in ADRs 0030, 0035, 0041 and 0047 must
    still hold.

**Phase 2: the new checks and fixes from §4b.**
- Rows 1, 3, 4, 7, 9, 12, 14, 15, 16, 21, 22 and 23.
- `sdk_localhost_only` comes first, because it is the one measured new-user stall.
  It needs a small schema addition first: per-key, per-origin-kind first and last
  seen (for example a `project_api_key_origins` table written by the ingest
  heartbeat), because `project_api_keys.last_seen_origin` holds only the latest
  value. It is additive DDL, deployed before the check reads it.
- Files:
  - `_shared/sdk-health.ts` (origin kinds; `isNativeOrigin` exists in
    `apps/admin/src/lib/sdkClientPlatform.ts`);
  - `_shared/setup-gaps.ts`;
  - the Cursor adapter `_shared/cursor-cloud.ts` (on-demand and branch probes);
  - `packages/cli/src/worker/*` (hook preflight at install);
  - `packages/cli/src/doctor.ts` (`--live`).
- Risks:
  - GitHub API rate limits. Mitigation: reuse the 10-minute cache.
  - The hook preflight must never bypass hooks.

**Phase 3: the outside in the console and the widget.**
- `pages/OnboardingPage.tsx`: 5 tabs become the three-state card; the tabs move
  behind More, and `?tab=` links still resolve.
- `pages/DashboardPage.tsx`: three zones and Details.
- `pages/FirstUserTestPage.tsx` and `components/ux-runs/FreshEyesPanel.tsx`:
  three-line result, and "Set up this computer" when no worker can take the run.
- `pages/ReportDetailPage.tsx`: "Fix it" or "Copy fix prompt".
- `packages/core/src/presets.ts` and the widget views: Standard hides
  leaderboard, roadmap, assistant and cross-app reports.
- `packages/cli/src/init.ts`: drop the Rewards prompt.
- Tests to update: `OnboardingPage.progress.test.ts`, `DashboardPage.setup.test.tsx`,
  `HomeSections.test.tsx`, the widget snapshot tests.
- Risk: existing hosts relying on a preset's current views. Mitigation: change the
  default only for new installs and keep explicit config winning (as `presets.ts`
  already guarantees).

**Phase 4: the parts layer in Settings.**
- Files: `pages/SettingsPage.tsx`, `lib/settingsTabs.ts`,
  `lib/settingsTabExplainer.ts`, `components/settings/*` (each panel becomes
  one part's Advanced section), `components/settings/SettingsRow.tsx` as the
  shared four-line part header.
- No columns are dropped. The 6 tab ids stay as aliases.
- Risk: moving deep links. Mitigation: the alias table in `lib/settingsTabs.ts`.

**Phase 5: the landing (after Phases 1–2 make the self-check claim true).**
- Files: `apps/docs/lib/landing-copy.ts` (`LANDING_SETUP_PROMPT`, the self-check
  line), `apps/docs/content/index.mdx`, and `LandingAudience.tsx` /
  `LandingFeatures.tsx` only if the owner picks option B.
- Test: `lib/landing-cinematic.test.ts`.

**ADRs this touches (proposals for the owner, none written):**
- **New ADR (proposed): "Setup and health checks are one registry. A failing root
  cause pauses what depends on it and shows once."** It relates to 0029 (confirm
  before filing), 0033 (infra failures are not code failures), 0048 (local workers)
  and 0047 (agent PRs run CI only after review approves).
- **0052:** only if the owner picks landing option B. It reverses part of the
  2026-10-29 amendment.
- **0053:** no change. The "Set up this computer" state fits its 2026-10-28
  amendment. A hosted runner stays a separate decision.
- **0027 and `lib/mode.ts`:** the sidebar is unchanged. Home's zones and the Set up
  card change inside pages only.
- **0016 and 0017 (recipe, portfolio):** parts reuse recipe facts (default branch,
  deploy targets), and none of it reaches the public path.

---

## 7. Top 5 changes, ranked by expected drop-off reduction

Expected effects are judgement, not measurements. Phase 0 is what turns them into
numbers.

1. **Go-live check with a fix (`sdk_localhost_only`, Set up step 3 "Go live").**
   This is the one measured stall: all 3 outside keys that ever checked in were
   last seen from localhost, and 0 reports followed. It addresses the step where every
   real sign-up stopped. (Phase 2, with the card from Phase 3.)
2. **One Health check, root causes shown once, and stop the line.** The same 3 gaps
   are open on all 4 pilot apps. At least 57 of the top 79 failure runs repeat an
   environment fault. This cuts an owner's list from dozens of rows to 3 or fewer.
   (Phase 1.)
3. **Three buttons on first run, and three zones on Home.** It takes away the 5
   tabs, 10 steps and 11 sections a user meets right after their first diagnosis.
   (Phase 3.)
4. **A fix button that cannot fail after the click.** "Fix it" appears only when a
   key and branch are known to work; otherwise the button is "Copy fix prompt".
   Auto-fix cannot be on without a working key. (Phases 2 and 3.)
5. **Parts with defaults, and quieter extras.**
   - The 230 settings move behind 9 parts that share one shape.
   - New apps' widgets hide leaderboard, roadmap and assistant.
   - The CLI drops the Rewards prompt.

   (Phases 3 and 4.)

Phase 0 (actor on every funnel event, the missing funnel steps) is not ranked
because it does not reduce drop-off by itself. Do it first: without it, none of the
five can be shown to work.
