# Mushi Mushi Cloud

Source: https://kensaur.us/mushi-mushi/docs/cloud

---
title: Mushi Mushi Cloud
description: Hosted Mushi Mushi. Bug reports, plain-English diagnoses, and fix dispatch without running servers. Free for one app with 100 diagnoses a month.
---

# Mushi Mushi Cloud

## Plans

A plan belongs to your team, not to one app. Its diagnoses are shared by
every app in the team, and so are the app limit, seats, history, plugins and
the spend cap. Upgrade from any app's card and the whole team moves to the
plan. [Pricing](/pricing) has the details.

No plan needs an AI key of your own: Mushi Mushi's AI writes the diagnosis.
You can add your own Anthropic, OpenAI or Cursor key on any plan, Free
included. Mushi Mushi then uses your Anthropic or OpenAI key first for the
diagnosis and for fix drafts; a diagnosis on your own key still counts toward
your plan. The Integrations page (Sentry, Slack, GitHub, Linear, Jira) works on
every plan; installing plugins from the Marketplace needs Builder or above, and
team invites need Studio. Full details are on [pricing](/pricing).

## Sign-up flow

1. `kensaur.us/mushi-mushi/admin`: email and password, or a GitHub account when that sign-in is offered.
2. Email confirmation (for email sign-up) → sign in → `/onboarding` wizard.
3. Create your first app, then run `npx mushi-mushi` in its folder to install the SDK. The wizard makes the key for you.
4. The Billing page in the console shows your team's diagnoses used / limit, with an **Upgrade team** button
   (**Change team plan** once you pay).
5. Stripe Checkout → on success, your subscription becomes active. Overage on monthly plans bills through Stripe meter events.

## Why metered on diagnoses

## Spend controls

Every monthly paid plan has a **hard cap on overage spend** ($50 Builder, $200 Studio by default). The cap covers the whole team and is set in the console under Billing → Spending cap; set it to $0 for a fixed bill. When the cap is reached, Mushi Mushi pauses new diagnoses for the rest of the calendar month with an upgrade prompt. Annual plans have no overage and stop at the included diagnoses. You also receive email alerts at 50%, 80% and 100% of your included diagnoses.

## Self-hosting

If you'd rather run Mushi Mushi on your own Supabase project, see
[Self-hosting](/self-hosting). The Cloud code is in the public repo: the
server is AGPLv3, and the enterprise features in `packages/server/ee`
(SSO, audit export, retention policies) are source-available and need a
license in production. Cloud also carries its own tuning data (prompt
wording, evaluation sets) as configuration; the repo ships working default
prompts. Self-hosting is free forever; you supply your own LLM keys.
