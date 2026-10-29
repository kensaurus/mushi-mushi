# 0027. The console sidebar follows the vibe-coding cycle

Status: Accepted (owner, 2026-10-14); the /recipe placement and keeping
"Triage grading" were confirmed by the coordinating session the same day.
Date: 2026-10-14

Related: `apps/admin/src/lib/navRegistry.ts` (`NAV_SECTION_META`,
`NAV_REGISTRY`, `SIMPLE_NAV_GROUPS`), `apps/admin/src/lib/extendedNavMeta.ts`
(section badges), `apps/admin/src/components/Layout.tsx`,
`apps/docs/content/admin/_meta.ts`, `apps/docs/components/landing/LandingInstallStrip.tsx`;
Plan 021 Phase 3 (page hubs); ADR 0026 (one MCP connection, used by the
landing's keyless installs).

## Context

The owner asked for the console's pages to be ordered and grouped "to make
more logical sense and be easier to follow through the vibe coding dev
cycle" (2026-10-14).

The Advanced sidebar had six sections from the 2026-10-08 regroup: Start
here, Bugs coming in, Fixing, Quality & health, Connect & automate, Account
& admin. They did not follow any order a builder works in:

- Start here mixed setup, Home, To-do, All apps and support.
- Connecting tools sat in three places: Connect (Start), Editor agents and
  Integrations (Connect & automate), and Set up.
- Releases, Experiments and Research sat under Quality & health.
- "All apps" named two pages: /portfolio and Home's apps view.
- Quick and Beginner used a third set of groups (Find & fix bugs, Your apps,
  Connect your tools, Account).

Sources cited in the owner's brief (2026-10-14):

- The Vercel dashboard redesign put the most common developer workflows
  first in one consistent sidebar
  ([changelog](https://vercel.com/changelog/dashboard-navigation-redesign-rollout)).
- Anthropic's Claude Code best practices say to verify and then show
  evidence ([docs](https://code.claude.com/docs/en/best-practices)), so
  checking a fix is its own step before shipping it.
- Erik Schluntz's "Vibe coding in production" (Anthropic) casts the human as
  the PM who checks verifiable outputs.

## Decision

- **Advanced shows one cycle, numbered, then Account.**

  | Section id | Title | Pages, in order |
  |---|---|---|
  | `start` | 1 · Connect | Set up, Connect, Integrations, Editor agents, Agent skills |
  | `plan` | 2 · Bugs | Home, To-do, Bugs, Bug clusters, Voice reports, Spam & abuse |
  | `do` | 3 · Fix | Fixes, Pull requests, Code map, UX runs, Improvement runs |
  | `check` | 4 · Verify | App checks: Scheduled tests, User stories, Full-stack audit, App blueprint, App health, Design system, Content checks. AI quality: Triage grading, Lessons, AI prompts |
  | `act` | 5 · Ship & watch | All apps, Releases, Reporter updates, Experiments, Research |
  | `workspace` | Account | Settings, Team, Manage apps, Plugins, Processing jobs, Tester rewards, SQL query, All users, Help & support, Feature requests |

  App blueprint (/recipe) was missing from the brief (placement confirmed
  2026-10-14). It stays under Verify → App checks, next to the audits: it is
  the app's own make-up (ADR 0016), and the Advanced list must keep more
  than twice Beginner's pages.
- **The six section ids stay.** Only titles, order and membership change,
  so the PDCA stage mapping, the palette groups and every hard-coded id keep
  working. The rail shows the step number (1–5, A for Account) instead of
  the P/D/C/A letter, and a numbered title drops the letter chip.
- **A moved page takes its metadata with it.** Its stage chip, palette
  heading and section badge follow its new section. Integration health,
  Editor agents and Agent skills now count under Connect; Home under Bugs;
  Releases, Research and Weekly insights under Ship & watch; Plugins and
  Feature requests under Account. Rewards stop being counted twice.
- **Quick and Beginner use the same cycle.** Their groups are Connect,
  Bugs, Fix, Verify (Beginner only), Ship & watch, Account. Quick stays at
  most 12 pages and Beginner at most 20.
- **One name per page.** Home's apps view is "Overview", so "All apps" means
  /portfolio only. Every former name stays a palette keyword.
- **/judge keeps "Triage grading"** (confirmed 2026-10-14). The
  brief asked for "Fix grading" because the palette description said the
  page grades fixes. What the page shows is triage grading: its score axes
  are accuracy, severity, component and repro, its rows come from
  `classification_evaluations`, and its disagreement filter compares the
  judge with the classifier; copy.ts already called it "How well the AI
  triages bugs". So the description was corrected and "fix grading" stays a
  search alias. AGENTS.md describes `judge-batch` as grading fix quality;
  if the page should grade fixes too, that is a page change, not a rename.
- **The docs follow the same order.** The admin docs sidebar uses the same
  six separators, and the landing page's "How it works" strip uses the same
  three steps: install, users report bugs, Mushi diagnoses and opens a fix
  you review.

## Rejected

- *New section ids* (for example `connect`, `verify`). They would touch the
  PDCA stage letters, the palette group union, `SECTION_ORDER`, the badge
  switch and the ribbon for no user-visible gain.
- *Merging Verify into Fix.* Checking a fix is its own step before shipping
  it, which is the point of the best-practice source above.
- *Renaming the pipeline ribbon's Plan / Do / Check / Act tiles.* The ribbon
  is Advanced-only and did not show the old section titles; it can follow
  later.

## Consequences

- Muscle memory from the 2026-10-08 sidebar breaks once. The palette still
  finds every page by its current or former name.
- A new page must be placed in the cycle step where a builder needs it, and
  its `paletteGroup` must match its section; `navRegistry.test.ts` pins the
  section order, the Quick group order and the palette groups.

## Amendment (owner, 2026-10-27): every page has a place in the sidebar

The owner found pages missing from the sidebar ("some of the pages and
subpages are not showing on the sidebar", Pipeline first). The 2026-10-20
console audit had cut the sidebar to nine core pages plus opt-in Labs; 17
pages were neither, so only ⌘K or a link reached them, and nothing was
highlighted while you were on one.

- **Pipeline is a core page**, after Fixes.
- **Sub-pages open under their page** while you are in that family
  (`lib/sidebarTree.ts`, `NAV_CHILDREN`): Apps › Manage apps and Checks ›
  every check. The sub-page you are on is the highlighted one. Pages that
  switch views with their own tab strip (Home, Team) list none: on
  2026-10-28 the owner found every tab repeated in the sidebar. The
  current page is scrolled into view.
- **More pages lists every other page**, grouped by the cycle sections above,
  and opens by itself when you are on one of them. A Lab kept in the sidebar
  leaves the list. The "This page is not in your sidebar" notice is gone.
- `sidebarTree.test.ts` fails when a sidebar page has no place, or a console
  route has no registry page and no stated reason.
- **Display settings left the page.** Theme, density, table rows and focus mode
  moved from icon rows in the sidebar footer (and a table-row switch inside the
  Bugs, Fixes and Compliance tables) to the menu under the user's name and
  Settings › Display & sidebar (formerly Labs; `?tab=labs` still opens it).
  The Admin / Tester switch at the top of the admin sidebar became a link in
  that menu; the tester portal keeps its switch back.
