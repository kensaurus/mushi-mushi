# Journey optimizer

Source: https://kensaur.us/mushi-mushi/docs/admin/journeys

---
title: Journey optimizer
description: Map how people move through your app, then fix dead ends, pages people leave, duplicate pages and pages nothing links to, with prompts for your coding agent.
---

# Journey optimizer

**Route:** `/journeys` (sidebar: Journeys)

> **Scenario:** Your AI built the app fast. Now you want to know where people get
> lost: which page they leave from, which two pages say the same thing, and which
> page nobody can find. Then you want the fix in your editor.

The Journey optimizer builds one map from two sources. Either one is enough on its own.

| Source | What it adds | What you need |
| --- | --- | --- |
| **Real visits** | Where people arrive, the paths they take, where they leave, pages they go back and forth between, pages they reload | The Mushi Mushi SDK with session tracking on (`trackSessions`, on by default), or `'on-demand'` with a recording window |
| **Site scan** | Your site map from its own links, pages nothing links to, pages too many clicks deep, duplicate and near-duplicate pages, pages that share a title | A Firecrawl key in **Settings → AI keys** |
| **Live-site watch** (optional) | Broken pages on the map | The watch turned on under **User stories → Discovery** |

## Record visits only when you need them

Every recorded visit sends a few small requests (start, page views, a heartbeat
every minute while the tab is open). If that is too much for every visitor, run
the SDK with `trackSessions: 'on-demand'`:

```ts
Mushi.init({ projectId, apiKey, trackSessions: 'on-demand' })
```

Then nothing is sent until you ask:

- **Record visits on demand** on this page opens a window for 1 hour, 1 day or
  1 week, for 10%, 50% or all visitors. Each device is drawn in or out once
  and stays that way, so no visit is half recorded. **Stop** ends it at once.
- **Test in your own browser** copies your address with `?mushi_journeys=1`.
  That tab records whatever the window says; `?mushi_journeys=0` turns it off.

The SDK reads the window from the settings it already loads, so outside a
window it adds no request at all.

## Scan your site

Type your live address (Mushi Mushi fills it in when it knows it) and press **Scan my site**.
The scan reads up to 40 public pages, about 41 Firecrawl credits, and usually finishes in
under a minute. It uses no AI model and changes nothing on your site. Mushi Mushi keeps
each page's title, its links and a fingerprint of its text, never the text itself, and
keeps the newest 10 scans. One scan runs at a time, at most one every 10 minutes.

## Read the map

- Each card is a page: visits, the share of visits that end there, and how many clicks
  it is from the start page. Its border is red for a fix-first problem and amber for one
  worth fixing.
- Each arrow is people moving from one page to the next. A thicker arrow means more people.
- With a scan, a **dashed** arrow means people moved without a link on the page (menu,
  back button or search), and a **dotted** one is a link nobody used.
- Click a page to see only its problems. Pick 7, 30 or 90 days at the top of the map.

## What it finds

| Finding | Means | Usual fix |
| --- | --- | --- |
| Broken page | The live-site watch found the page failing | Fix the page, then the links to it |
| Dead end | Most visits end here and the page links nowhere but the menu | Add one clear next step |
| People leave | Most visits end here | Make the main action easy to see; check the page answers what people came for |
| Back and forth | People open a page and go straight back | Say on the link what the page holds, or put the missing part on it |
| Reloaded | People open the same page again right away | Check for slow loading or a form that seems not to save |
| Duplicate pages | Two or more pages share most of their text | Merge and redirect, or make each page about one thing |
| Same page, two addresses | `/About` and `/about`, `/pricing.html` and `/pricing` | Pick one address and redirect the others |
| Same title | Pages share a title | Give each page its own title |
| Nothing links here | No scanned page links to it | Link to it where people look, or remove it |
| Too deep | 4 or more clicks from the start page | Link to it from the start page or menu |
| Never opened | Scanned pages no visit opened | Link to them, or remove them |

Thank-you, success, logout and 404 pages are never flagged for people leaving: leaving is
the point there.

## Hand it to your coding agent

Every finding has **Copy prompt for your coding agent**: a self-contained instruction
naming the pages, what is wrong and what to change. Paste it into Cursor, Claude Code,
Lovable or Bolt. **Copy all as one prompt** gives the agent the whole list, worst first.

The **Journey score** starts at 100 and drops for each finding: a fix-first one costs
the most. Use it to see a change land, not as a grade.

## Related

- [First-time user test](/admin/ux-runs): an AI tries one goal as a new user and shows where it got stuck.
- [User stories](/admin/inventory): the crawl that drafts what users can do in your app.
- Home → **Pages**: the busiest pages at a glance, with a link here.
