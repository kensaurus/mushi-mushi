# 0066. A hub's view tabs sit under the page title; account pages carry no one-app bar

Status: Accepted 2026-11-21 by team-lead (Claude), on the owner's request for a production-ready console UX ("go through each page in mushi, give a score and what can be improved, and burn them down page by page"). Date: 2026-11-21

Supersedes the chrome order of Plan 021 (Home, Mushi Mushi health and Team as `?view=` hubs, `lib/pageHubs.ts`): the hub's view row sat above the page.

Related: `components/PageHubView.tsx`, `components/PageHeaderTabs.tsx`, `components/PageHeaderBar.tsx`, `pages/HealthPage.tsx`, `components/health/HealthSectionsBar.tsx`, `lib/projectScope.ts`, `components/ProjectScopeNotice.tsx`.

## Context

The console UX audit of 2026-11-21 scored every routed page at 1440 px. Two
pieces of shared chrome read wrong on many pages at once.

- **Hub tabs above the title.** On Home, Team and Mushi Mushi health, the
  first thing under the one-app bar was the row of views ("Today Overview User
  activity …"), then the page title ("Overview"), then the page. The title,
  which says what the page is, came second. The tabs also read as site
  navigation rather than as parts of the page.
- **The one-app bar on an account page.** "This page shows one app at a time:
  lets-talk. Switch app" showed on Help & support, which lists your tickets to
  the Mushi team from every app, each with its app name.

## Decision

1. **Tabs under the title.** The hub does not render the page header (each view
   is a whole page with its own `PageHeaderBar`), so it hands its tabs down
   through `PageHeaderTabsProvider`. The first `PageHeaderBar` under the hub
   claims them and draws them below its title row. Until a header claims them
   (a view still loading, a locked view, an error), the hub draws them at the
   top, so they never disappear. A second header inside a page never repeats
   them. At desktop widths the row is one line and scrolls, with an edge fade,
   when it is wider than the column. Mushi Mushi health's single sections bar
   (`HealthSectionsBar`) takes the same slot.
2. **Account pages have no one-app bar.** `/feedback` joins the account-wide
   routes in `lib/projectScope.ts`. Team's Billing, AI spend, Audit log and
   Storage keep the bar, because they read the open app (the registry says so).

## Alternatives rejected

- **Render the header in the hub.** Each view's header carries its own actions,
  help and freshness. Lifting them into the hub would move every view's header
  code, for no gain.
- **Keep the tabs above and enlarge the title.** The order problem stays: the
  tabs still come before the thing they divide.
- **A portal into a DOM slot.** It works, but a context claim keeps the fallback
  (no header yet) and the one-claimant rule in React, testable without a DOM
  query.

## Consequences

- Pages outside a hub are unchanged: `useClaimedHeaderTabs()` returns nothing.
- A hub view without a `PageHeaderBar` still shows its tabs at the top.
- The console is desktop-first (owner, 2026-11-21: "mushimushi is meant to be
  desktop"), so the layout is checked at 1440 and 1280. The narrow-width
  wrapping kept from 2026-11-19 is not a target.
