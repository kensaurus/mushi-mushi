# 0069. The builder console is the fix loop; operator machinery is one click away

Status: Accepted (owner, 2026-11-24). Supersedes the builder sidebar part of
ADR 0027. Narrows how ADR 0058's second pillar (journeys) is surfaced; it does
not change the category or the pillars.
Date: 2026-11-24

Related: `apps/admin/src/lib/navRegistry.ts` (`BUILDER_CORE_NAV_PATHS`,
`CORE_NAV_PATHS`, `coreNavPathsFor`), `apps/admin/src/lib/labs.ts`,
`apps/admin/src/pages/DashboardPage.tsx`, `FixesPage.tsx`, `ConnectPage.tsx`,
`SettingsPage.tsx`, `ReportDetailPage.tsx`; ADR 0027 (sidebar follows the
vibe-coding cycle), ADR 0052 (the public surface leads with one job), ADR 0058
(one place to improve AI-built apps).

## Context

The owner said the console is over-engineered for its use case and hard to use
for the general public (2026-11-24). A fresh account walked from the landing
page (kensaurus+fresh1124, 2026-11-24) measured the problem:

- The first diagnosis arrives about 2 s after "Send test report" and reads
  well. Everything after it is heavy.
- On a brand-new app, Connect showed 555 words, 91 buttons and links, and 44
  tabs. Settings showed 689 words and 58 controls. Home showed 323 words, 45
  controls and 5 view tabs, with 8 mostly empty cards. Pipeline showed an
  8-stage factory: release trains, workers, pace.
- The Journey optimizer, a core builder page, does nothing until the user adds
  their own Firecrawl key.
- Over the last 90 days, 6 accounts outside the owner's signed up and 1 got as
  far as an SDK check-in. Usage data cannot rank pages yet, so the order below
  is judgment.

The 2026-10-20 audit already removed the Quick, Beginner and Advanced modes and
moved 20 pages into opt-in Labs. The page count was not the problem. The
operator's machinery sat on the builder's path: the pipeline, release trains,
the merge queue and CI concepts.

Sources (read 2026-11-24):

- The Vercel dashboard navigation redesign (2026-02-26) orders the sidebar by
  the most common workflows.
- PostHog's new UI (2026-11-11) replaced a long product sidebar with a short
  rail grouped by job.
- Sentry's new navigation (2025-06-05) was made because the old one "felt
  cramped".
- NN/g on progressive disclosure: pick the first-shown options by how often
  they are used, and keep to two disclosure levels at most.
- NN/g on empty states: say what will appear there and how to get it.
- NN/g on onboarding tutorials: contextual help works better than tours.

## Decision

- **The builder sidebar is the fix loop:** Home, Bugs, Fixes, Connect,
  Settings. Set up shows only until setup is done. Pipeline becomes the
  operator Lab "Pipeline". The Journey optimizer leaves the sidebar until it
  works without a key the user must bring. Its page, the Home "Pages" card and
  every link to it stay, so pillar 2 is still one click away.
- **The owner's account sees the builder sidebar by default.** Operator pages
  (Pipeline, CI runners, Ops, release trains) are one click away in Labs and
  ⌘K. Nothing is deleted, and every URL keeps working.
- **Home is one list of next actions.** "Needs you" comes first, one button
  per item. Builders get no view tabs. The other views move under Apps. Cards
  with no data stay hidden until they have something to show.
- **Fixes is a list of fixes.** Release train, merge queue, "Decide for me"
  and the stopped-reasons breakdown move into one collapsed "Automation"
  section.
- **Connect is one step at a time, driven by state:** report button, then
  editor, then GitHub. The editor picker leads with three common clients plus
  "Other".
- **A bug report has one primary action:** copy the fix prompt, or open it in
  the editor. The diagnosis evidence graph and the pipeline strip start
  collapsed.
- **Done is measured.** Re-run the fresh-account walk. Targets: Connect under
  200 words, under 30 controls and under 10 tabs; Home under 20 controls with
  no tabs; no console errors. Activation is the first real report diagnosed,
  read from `setup_funnel_events`.

## Rejected

- **Bringing back a beginner/advanced switch.** The 10-20 audit removed it,
  and NN/g on modes warns that features hidden behind a mode are hard to find
  again.
- **Deleting operator pages.** The owner runs 10 apps on them. They move, they
  are not removed.
- **A product tour.** Contextual help and honest empty states instead.

## Consequences

- ADR 0027's numbered cycle remains for the operator view; builders see the
  shorter loop.
- `docs/admin` pages that walk through the sidebar must follow the new order.
