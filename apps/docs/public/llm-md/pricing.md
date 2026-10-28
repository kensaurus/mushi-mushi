# Pricing — Free, Builder, Studio and self-host

Source: https://kensaur.us/mushi-mushi/docs/pricing

---
title: Pricing — Free, Builder, Studio and self-host
description: Mushi Mushi pricing — free for one app and 100 AI bug diagnoses a month. Builder $29/mo for 3 apps, Studio $79/mo for 10. Free to self-host.
---

# Pricing

## Plans

A plan is the number of **apps** Mushi watches for your team: one on Free, three on Builder, ten on Studio. Diagnoses are the allowance under it. Reports are always captured and are never billed.

  **Annual billing saves two months.** Pay for 10 months, get 12: Builder is $290 a year, Studio $790. Annual plans have no pay-as-you-go overage: they include the plan's diagnoses each month and pause new diagnoses at that limit. Pick annual at checkout, or switch an existing plan with **Change plan** on the Billing page. For Enterprise commits, contact us.

  **Overage is capped.** Builder and Studio include a default spend cap ($50 and $200). You can lower or raise it in the console. At the cap, Mushi pauses new diagnoses with a graceful message — never a surprise invoice. Email alerts fire at **50%, 80%, and 100%** of your included diagnoses.

  **Free has a hard stop** — not a soft limit. At 100 diagnoses Mushi stops diagnosing new reports until the next calendar month. No card, no charge, no bill shock.

## What counts as a diagnosis

One diagnosis = one completed classification pass. Specifically:

- The report passes the fast noise filter (not spam or incomplete junk).
- It is not a duplicate of an existing group already classified this period.
- The classifier finishes and writes a plain-English root cause + severity + fix hint.

Under the hood that is a two-stage pipeline (Haiku fast-filter → Sonnet structured output). Classification, deduplication, fix attempts, knowledge-graph writes, and MCP tool calls are **not** counted separately — they are included in the per-diagnosis price.

**What does NOT count:**

- Reports filtered by the fast-filter (noise, spam, incomplete submissions).
- Reports deduplicated to an existing group (same broken button, same stack trace — they collapse, you only pay once).
- Inbound adapter events (Sentry alerts, Datadog webhooks) that don't complete a fresh diagnosis.
- MCP `get_fix_context` calls, fix dispatch, or any read-only operation.

## Pricing estimator

Use the slider below to model your bill. Toggle **Annual** to see the effective monthly base fee. When you hit a tier limit, the estimator suggests the next plan.

## Example bills

Fixed formulas (overage metered on top of base):

```
Builder: $29 + max(0, diagnoses − 1,000) × $0.03  (capped at $50/mo total)
Studio:  $79 + max(0, diagnoses − 5,000) × $0.02  (capped at $200/mo total)
```

| Diagnoses / mo | Builder | Studio |
|---:|---:|---:|
| 100 | $29.00 | $79.00 |
| 500 | $29.00 | $79.00 |
| 1,000 | $29.00 | $79.00 |
| 1,500 | $44.00 | $79.00 |
| 2,000 | $50.00 *(cap)* | $79.00 |
| 5,000 | $50.00 *(cap)* | $79.00 |
| 8,000 | $50.00 *(cap)* | $139.00 |
| 12,000 | $50.00 *(cap)* | $200.00 *(cap)* |

A typical vibe-coder app runs **200–400 diagnoses / month**, well inside Builder's 1,000. Most people move up for a second or fourth app, not for more diagnoses.

## Why apps, not reports?

Reports are noisy: one broken button can send fifty, and a busy week is hard to predict. The number of apps you ship is something you already know, and it grows with what you get out of Mushi. So a plan is sized by apps watched, diagnoses are a generous allowance under it, and reports are never billed at all.

## Why diagnoses, not events

Sentry meters errors. We meter comprehension — a unit you can actually predict and that maps 1:1 to the value delivered (a plain-English root cause + paste-ready fix). Duplicate errors from the same broken button collapse to one diagnosis. You pay once.

## Your own AI key and the self-host path

On every Cloud plan, Free included, you can add your own Anthropic, OpenAI or Cursor key under **Settings → API keys**. Mushi then uses it for fix PRs and agent work; you pay those vendors directly at list rate, and we never mark up tokens.

When self-hosting, Mushi uses **your** keys for everything. Most teams run the full loop for under $20 / month in LLM costs.

The self-host path is completely free, always will be — [see the guide](/self-hosting).

## Compared to Sentry + Seer

| | Sentry Team + Seer | Mushi Builder |
|---|---|---|
| Base plan | $26 / mo | $29 / mo for 3 apps |
| AI diagnosis | Seer add-on: + $40 / active contributor / mo | Included |
| Solo dev total | **$66 + / mo** | **$29 / mo** |
| Catches non-crash friction | Via its User Feedback widget and Session Replay | Yes — shake-to-report with screenshot and console/network tail, then a diagnosis |
| Bugs in your editor | Sentry MCP server: issues and Seer analysis in Cursor / Claude Code | Mushi MCP server: diagnosis, fix prompt and lessons; no second LLM key |

Sentry prices from [sentry.io/pricing](https://sentry.io/pricing/) and [Sentry's pricing docs](https://docs.sentry.io/pricing/), checked 2026-09-21. Seer is an add-on to the Team, Business or Enterprise plan, billed as its own monthly charge. An active contributor is anyone who opens two or more pull requests in a month to a Seer-enabled repo; the $66 total assumes one of them. Seer is not available in self-hosted Sentry.

Sentry + Seer is strong at code-thrown errors, tracing, breadcrumbs and session replay, and Seer is an AI debugging agent for those issues. Mushi starts from user-felt friction that never triggers an error, ingests Sentry's errors too, and turns each into a plain-English diagnosis and a paste-ready fix prompt in your editor. A diagnosis is an LLM's reading and can be wrong; check it before you merge.

## Frequently asked questions

### What happens when I hit my diagnosis limit?

**Free:** New plain-English diagnoses pause until the next calendar month. Reports are still captured.

**Builder / Studio (monthly):** You can keep diagnosing into overage until your **spend cap** stops new classification runs. Reports are never dropped.

**Builder / Studio (annual):** New diagnoses pause at the included amount until the next calendar month. Reports are never dropped. Switch to monthly (pay-as-you-go overage) or to Studio from **Change plan**.

### What happens when I add one app too many?

The console says how many apps your plan watches and how many your team has, and offers the plans. Nothing already running stops: your existing apps keep their reports and diagnoses. Move up a plan, or remove an app you no longer use.

### Can I use my own AI key on Free?

Yes. Bring-your-own-key works on every plan, Free included. Add an Anthropic, OpenAI or Cursor key under **Settings → API keys** and Mushi can open fix PRs with it, so you see the whole loop on your first app before paying anything. Automatic fix PRs without you in the loop start on Builder.

### When does my quota reset?

Cloud plans reset on your **Stripe billing period** (shown on the Billing page as “Quota resets in N days”). Free resets on the calendar month (UTC).

### Can I change my spend cap?

Yes. Open **Billing → Spending cap** on your project card. Set any USD cap from $0–100,000 or clear it to use the plan default ($50 Builder, $200 Studio).

### Who receives usage alert emails?

By default, the **project owner**. Override the address under **Usage alert email** on the same card. Alerts fire once per threshold (50%, 80%, 100%) per billing month.

### Is usage per app or per team?

**Diagnoses are per app; the app limit is per team.** Each app you connect has its own diagnosis counter and spend cap, and the plan's app limit counts the apps in your team.

### Can I downgrade mid-cycle?

Change plans in the console with **Change plan** on the Billing page (Builder ↔ Studio, monthly ↔ annual). The change applies immediately and is pro-rated: unused time is credited and the new plan is charged for the rest of the period. Moving between monthly and annual starts a new billing period that day. Stripe's customer portal (**Manage**) handles your card, invoices and cancellation.

### Do annual plans include overage?

No. Annual plans include the plan's diagnoses every month (1,000 on Builder, 5,000 on Studio) and pause new diagnoses at that limit until the next month, so an annual invoice never grows. If you need more, switch to monthly for pay-as-you-go overage or upgrade to Studio from **Change plan**.

### What does Enterprise cost?

From $499 a month, billed annually: unlimited apps, SAML SSO, the SOC 2 readiness pack, self-host support and up to 365 days of history. [Contact us](mailto:kensaurus@gmail.com?subject=Mushi%20Enterprise%20inquiry) for a quote.

### How do I estimate before signing up?

Use the interactive estimator above, or run `mushi billing status` after wiring the SDK — it shows diagnoses used, limit, and spend cap for the current period.

## Start free

Prefer the terminal? `npx mushi-mushi` runs the wizard — detect framework, install the SDK, write env vars, connect MCP. See the [incident loop quickstart](/quickstart/incident-loop), or [create your free account in the console](https://kensaur.us/mushi-mushi/admin/signup?src=pricing-text).
