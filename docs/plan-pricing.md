# Pricing Plan — Mushi Mushi

_Plan-only. Nothing changes until the owner approves. Written 2026-10-28._

## Short answer

The plans are not coherent yet and will not, by themselves, produce GTM or
revenue. Pricing is not the binding constraint today: there are **0 Stripe
subscriptions, 10 outside sign-ups, 0 outside reports** (critical audit
2026-10-27). The paywall also sits in front of the one moment that would make a
vibe coder pay. Fix the meter and the free boundary first, prove activation,
then test price.

## Current model (evidence)

`pricing_plans` in production (read 2026-10-28), `_shared/plans.ts`,
`apps/docs/lib/pricing-estimator.ts`.

| Tier | Price | Meter actually enforced | Gates | Source |
|---|---|---|---|---|
| Free Cloud | $0 | 50 diagnoses/mo, hard stop; 1 seat; 7-day retention | no BYOK (no own AI/Cursor key → no fix PRs, no reviews), no plugins, no audit log | `pricing_plans.free_cloud` |
| Indie | $15/mo | 500 diagnoses, then $0.03 each, cap $50; 1 seat; 30 days | BYOK, plugins, audit log, 48 h email | `pricing_plans.indie` |
| Pro | $49/mo | 2,000 diagnoses, then $0.025, cap $200; 5 seats; 90 days; also 50,000 reports then $0.002 | + teams, intelligence reports, inventory v2, 8 h | `pricing_plans.pro` |
| Enterprise | $499/mo in the table, shown as "Contact us" | none | SSO, SCIM, self-host, SOC 2, residency, 4 h | `pricing_plans.enterprise` |
| Hobby, Starter | inactive | — | legacy | |

Inconsistencies found:

1. **Two meters.** The console Billing table compares plans on *reports/month*
   ("Unlimited / Unlimited / 50,000", "$0.0020 / report"), while billing
   enforces *diagnoses* (50 / 500 / 2,000) shown only as "75 / 2,000 diagnoses".
   The public estimator uses diagnoses. A buyer cannot predict the bill from
   the console table.
2. **The paywall is on bringing your own key.** Free cannot add an Anthropic
   or Cursor key (`requireFeature('byok')`), so a free user never sees a fix PR
   or an Opus review: the "fix ready to go" half of the north star. Paying $15
   to use your own key is also hard to explain.
3. **Enterprise has no anchor.** "Contact us" with a hidden $499.
4. **Free is generous on the wrong axis.** A solo app files maybe 5–30 user
   reports a month; 50 diagnoses covers most of them forever, so volume never
   triggers an upgrade, while the feature that would (fixes) is locked.

Cost floor (llm_invocations, last 30 days, Mushi's own 9 apps, $154.55 total):

| Step | Cost per report | Who pays |
|---|---|---|
| Triage (fast-filter + classify) | ~$0.017 | Mushi's key on hosted plans |
| Opus PR review | ~$0.21 | the app's own key (BYOK) |
| Fix agent | Cursor credits | the app's own Cursor key |

A hosted diagnosis costs about $0.017 in LLM tokens; Indie's $0.03 overage
and Pro's $0.025 leave 30–45% before Supabase and support.

## Value metric

"Our customer receives more value when **more of their apps have bugs explained
and fixed without them debugging**."

| Candidate | Value | Fair | Predictable | Scales | Billable | Verdict |
|---|---|---|---|---|---|---|
| Diagnoses (today) | 4 | 3 | 2 (bug volume is unknown in advance) | 3 | 5 | keep as allowance, not the headline |
| **Apps watched** | 4 | 5 | 5 | 4 (portfolio operators, ADR 0017) | 5 | **primary** |
| Seats | 2 | 4 | 5 | 2 (solo buyer) | 5 | no: solo buyer |
| Fixes merged (outcome) | 5 | 4 | 2 | 4 | 4 | later, as proof on the page ("70 fixes merged this period") |
| Reports | 3 | 3 | 2 | 3 | 5 | drop from the UI |

Simulated on our own 9 apps: about 110 reports per app per month (inflated by
audits and agents). A typical outside solo app is far lower, so a diagnosis
allowance alone rarely forces an upgrade; the number of apps does.

## Proposed packaging (≤3 self-serve tiers + Enterprise from …)

| Tier | For whom | Includes | Limit | Monthly | Annual |
|---|---|---|---|---|---|
| Free | first app, see it work | SDK + widget, plain-English diagnosis, **bring your own key allowed**, fix packet in the editor (MCP/CLI), first-time user test | 1 app, 100 diagnoses, 14-day retention | $0 | — |
| Builder (recommended) | the solo vibe coder shipping to real users | everything in Free + automatic fix PRs with the Opus review gate, merge queue, Slack/Discord, Sentry on-ramp, site watch | 3 apps, 1,000 diagnoses then $0.03, cap you set; 90 days | $19–29 (test) | 2 months free |
| Studio | the portfolio operator (ADR 0017) | everything in Builder + portfolio Home, local worker lanes, release trains, weekly report, 5 seats | 10 apps, 5,000 diagnoses then $0.02; 180 days | $59–79 (test) | 2 months free |
| Enterprise | teams with compliance | SSO/SCIM, self-host, SOC 2 pack, residency, SLA | custom | **from $499/mo** shown | annual |

Add-on, not a tier: **hosted AI credits** for people who do not want to manage
keys (Mushi's key, metered at about 2× token cost, user-set cap). It removes the
"get an Anthropic key" step from onboarding, which is the second biggest drop
after "install on localhost". Needs a superseding ADR: today reviews never run
on the platform key (ADR 0030, `agent-pr-review` "only byok"), and BYOK is the
default posture.

Free boundary: the free app gets the full loop once (diagnosis → fix packet,
plus fix PRs if they bring a key), so activation happens on Free; the upgrade
trigger is a **second app** or **automation without the person in the loop**.

## Price corridor

| Tier | Floor (cost) | Alternatives (read 2026-10-28) | VW range | Proposed | Confidence |
|---|---|---|---|---|---|
| Builder | ~$2–5/mo LLM at 100–300 diagnoses | Jam Team $14/creator/mo yearly; Sentry Team $26/mo; Userback Team $29–39; CodeRabbit $24–30/dev; Cursor Premium $30 (includes Bugbot); Sentry Seer $40/active contributor | not run | $19–29 | low: unmeasured |
| Studio | ~$10–20/mo LLM | Sentry Business $80; Userback Business $79–99; CodeRabbit Team $48–60/dev | not run | $59–79 | low: unmeasured |
| Enterprise | support time | Sentry/CodeRabbit custom | — | from $499 | medium (already in table) |

Current Indie $15 sits under every named alternative and under Sentry's AI
debugging add-on alone ($40). Underpricing attracts the curious; the skill's
benchmark (an indie raise from £9 to £19 lifted month-3 retention from 42% to
67%) argues for the upper half of the corridor once activation works.

Sources: sentry.io/pricing, jam.dev/pricing, coderabbit.ai/pricing,
cursor.com/pricing, userback.io/pricing (all read 2026-10-28 via Firecrawl).
lovable.dev/pricing did not expose prices to the scraper (not used).

## Research plan

| Method | Sample | Question | Decides |
|---|---|---|---|
| 15 problem interviews | vibe coders shipping Lovable/Cursor/Bolt apps to real users (communities, not current sign-ups only) | last bug that cost an afternoon; what they paid to fix it; would they pay for fix PRs | whether Builder's value is fix PRs or diagnosis |
| Van Westendorp | the same 15 + the 10 sign-ups | four price questions on Builder | the corridor |
| Gabor-Granger | 30+ after activation works | buy at $19 / $24 / $29 | the Builder point |
| In-market test | live page, 60 days | $19 vs $29 Builder, fixed metric | revenue per visitor |

## Risks & keep-working

- **Activation first.** With 0 outside reports, no price change creates
  revenue. The north-star metric (activated external projects/week, GTM plan
  2026-09-20) must move before Phase 3.
- **Grandfathering:** no paying customers exist, so there is nothing to migrate;
  the 2 complimentary organizations stay complimentary.
- **Metering:** the console still meters and displays reports in places; fix the
  display before any new price ships (`audit-payment-system`).
- **ADR changes:** hosted AI credits and Free BYOK need owner-signed ADRs
  (ADR 0030 review key rule; BYOK posture).

## Phased burndown

- **Phase 0 — Coherence (no price change):** one meter everywhere (diagnoses),
  remove the reports rows from the console table, show Enterprise "from $499",
  allow bring-your-own-key on Free. → `enhance-web-conversion` for the table,
  server change to drop `requireFeature('byok')` on Free.
- **Phase 1 — Research:** interviews + Van Westendorp script (`docs-coauthor`).
- **Phase 2 — Packaging:** apps-watched as the headline limit, Builder/Studio
  names, hosted AI credits ADR. → `enhance-web-conversion`.
- **Phase 3 — Billing:** Stripe products/lookup keys for Builder/Studio,
  proration, caps (`audit-payment-system`).
- **Phase 4 — Measure:** `pricing_viewed`, `plan_selected`, `checkout_*`,
  activation → paid conversion; 60-day review (`audit-analytics`).
