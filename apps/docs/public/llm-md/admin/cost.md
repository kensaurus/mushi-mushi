# AI spend

Source: https://kensaur.us/mushi-mushi/docs/admin/cost

---
title: AI spend
description: The AI spend view in the Mushi Mushi console shows LLM token use and estimated spend per model and step for a project, so you can see what each diagnosis costs.
---

# AI spend

**Route:** `/team?view=spend` (**Team → AI spend**; the old `/cost` address redirects there)

The AI spend view shows the LLM calls Mushi Mushi made for the selected project and
what they cost, as estimated from token counts.

---

## What's tracked

Every AI call an edge function makes for the project (diagnosis, fixes, reviews,
judging and the rest) is written to the `llm_invocations` table with the function and
stage, the primary and used model, whether a fallback ran, status, latency, input and
output tokens, cache tokens, the prompt version, which key paid (`key_source`), and
`cost_usd`, an estimate from the model's price list.

---

## Tabs

- **Overview**: a **Daily spend** chart, a budget forecast, and **Compare to plan usage**
  (a link to Billing)
- **Breakdown**: cost **By operation** and **By model**
- **Raw log**: the **Invocation log**, one row per call

---

## Controlling costs

| Lever | Where to set it |
|-------|----------------|
| **Monthly AI budget** | Settings → General → Spend limits, or the budget card on the Overview tab (team owners and admins). Generation calls stop for the rest of the month once spend reaches it; embeddings count toward it but are not blocked |
| **Auto-fix limits** | Settings → General → Spend limits: spend per 30 days, automatic fixes per day, and an approval threshold |
| **Improvement run size** | Each run on [Improvement runs](/admin/iterate) sets its own iteration target |

---

## Related pages

- [Improvement runs](/admin/iterate): a large per-run cost driver
- [Fixes](/admin/fixes): what the fix agent spends
- [Settings](/admin/settings): spend limits and AI keys
- [Billing](/admin/billing): plan usage
