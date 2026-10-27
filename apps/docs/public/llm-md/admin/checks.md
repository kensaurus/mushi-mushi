# Checks

Source: https://kensaur.us/mushi-mushi/docs/admin/checks

---
title: Checks
description: The Checks page shows every automatic check on this app with its state, when it last ran and its open count, failing checks first.
---

# Checks

**Route:** `/checks`

Is my app OK, and which check is red? Every automatic check on this app, in one grid, failing checks first. A sentence at the top names the checks that need you, with one button to open the first.

Each card has a dot and a state:

| Dot | State | Meaning |
| --- | --- | --- |
| Red | Failed | The last run failed or could not finish. |
| Amber | N findings | The check ran and found something to fix. |
| Green | Pass | A finished run was read and found nothing. Shown with when it last ran. |
| Grey | Not run yet, Not set up, Status unavailable | Never a pass. Not set up comes with a Set up link. |

A Pro pill means the check needs a plan upgrade. AI prompts and CI runners are Labs: their cards appear once you turn them on in Settings → Labs.

## The checks

### App checks

Is the app itself sound: scheduled tests, user stories, audits, its blueprint, design tokens and content, plus Mushi’s own health.

| Card | Route | What it covers |
| --- | --- | --- |
| [Scheduled tests](/admin/qa-coverage) | `/qa-coverage` | Browser tests of your user stories that run on a schedule and alert when one breaks. |
| [Mushi health](/admin/health) | `/health` | Is Mushi itself working: its AI calls and background jobs. Also your code size, schema changes and unusual spikes. |
| [CI runners](/admin/ci) | `/ci` | Where your tests run, how long they wait for a machine, and what slows your fixes down. |
| [Full-stack audit](/admin/fullstack-audit) | `/fullstack-audit` | An end-to-end audit across the frontend, the API and the database. |
| [User stories](/admin/inventory) | `/inventory` | The things users can do in your app, found by crawling it, and which ones broke. |
| App blueprint | `/recipe` | What this app is built from — database, design system, routes, CI, deploy, env and integrations — and what changed. |
| Design system | `/design` | Design tokens, contrast pairs, type scale and off-token code. Token and rule edits open a draft pull request. |
| [Content checks](/admin/content) | `/content` | AI-generated and user-submitted content flagged as wrong or low quality. |

### AI quality

How good the AI's triage is: grading, lessons learned and the prompts behind it.

| Card | Route | What it covers |
| --- | --- | --- |
| [Triage grading](/admin/judge) | `/judge` | A second AI grades how well each bug was triaged and flags where it disagrees with the first. |
| [Lessons](/admin/lessons) | `/lessons` | Patterns learned from past bugs and fixes. |
| [AI prompts](/admin/prompt-lab) | `/prompt-lab` | Edit and compare the prompts that turn bug reports into pull requests. |
