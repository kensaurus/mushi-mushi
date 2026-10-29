# Overview (Home view)

Source: https://kensaur.us/mushi-mushi/docs/admin/overview

---
title: Overview (Home view)
description: The Overview view on Home in the Mushi Mushi console shows seven-day activity and open bugs for every connected app in a team at a glance.
---

# Overview

**Route:** `/dashboard?view=apps` (**Home → Overview**). The old `/overview` link redirects
there. For setup state, hole checks and spend across apps, see [Apps](/admin/portfolio).

> **Scenario:** You manage several connected projects and want a single org-scoped
> glance at 7-day activity and open tickets before diving into any one app.

In Mushi Mushi, Overview covers every app in the active team. Each card is one
connected app (sessions, users, open bugs and a DAU sparkline) with footer links
that switch the active app and open **User activity**, **Bugs** (or **Open bugs**),
**Home**, or **Recipe** when the app has a recipe state.

---

## What you see

| Element | Meaning |
|---------|---------|
| **Portfolio totals** | Aggregated 7-day sessions / users and open-ticket counts across projects |
| **Project cards** | Per-project `sessions_7d`, `users_7d`, open + critical reports, last report time |
| **DAU sparkline** | Daily active users for the last week on that project |
| **Health tone** | Critical if any critical reports; then not connected (no SDK heartbeat ever) or silent (heartbeat stopped); warn if open reports &gt; 5; quiet if no sessions in 7 days; otherwise ok |
| **Footer links** | Switch the active app, then open User activity, Bugs, Home or Recipe |

Cards sort so apps that need attention come first.

---

## Data source

```
GET /v1/admin/portfolio
```

Requires a console JWT and `X-Mushi-Org-Id` (set automatically from the org
switcher). Backed by the `org_portfolio_summary` RPC.

Empty state means no apps are linked to this team yet: **Create your first project →**
opens [Set up](/admin/onboarding).

---

## Related

- [User activity](/admin/activity) — per-app session and engagement detail (30-day window)
- [Home](/admin/dashboard) — the summary for the active app
- [Bugs](/admin/reports) — triage queue
- SDK session telemetry is emitted by `@mushi-mushi/web` / `@mushi-mushi/core`
  (opt out with `trackSessions: false` in `MushiConfig`)

  Overview covers the whole team. User activity and most other console pages cover one
  app: use a card footer link to switch app before drilling in.
