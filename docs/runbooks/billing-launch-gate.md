# Billing launch gate

<!--
  FILE: docs/runbooks/billing-launch-gate.md
  PURPOSE: Pre-Stripe / pre-launch checklist for diagnosis quota hard-stops and spend caps.
  OVERVIEW: Ensures caps STOP classification (HTTP 402), not just warn — a launch blocker.
  USAGE: Run through this checklist before enabling Stripe checkout or public launch.
-->

**Do not enable public Stripe checkout or announce paid tiers until every item below is green.**

This runbook validates the **diagnosis quota gate** in `classify-report` — the code path
that must **deny** Stage-2 Sonnet before an LLM call when a project is over quota or
spend cap. Alerts at 50% / 80% / 100% are informational only; **hard stops are the gate.**

## 1. Remote schema (Supabase)

Project: `dxptnwrhwsqckaftyymj` (Mushi Cloud)

- [ ] `pricing_plans` rows: `free_cloud` (50 diagnoses, no overage), `indie` ($15, 500, $0.03 overage, $50 cap), `pro` ($49, 2000, $0.025 overage, $200 cap)
- [ ] Migrations applied: `20260621100000_diagnoses_billing_tiers.sql`, usage alert thresholds
- [ ] `usage_events.event_name = 'diagnoses'` rows exclude `metadata.shadow = true`

## 2. Unit tests (local)

```bash
cd packages/server && pnpm exec vitest run src/__tests__/diagnosis-quota.test.ts
```

Must cover:

- [ ] Free Cloud at 50 → `allowed: false`, `NO_SUBSCRIPTION_OVER_FREE`
- [ ] Indie overage under cap → `allowed: true`, `overage: true`
- [ ] Indie at spend cap → `allowed: false`, `SPEND_CAP_REACHED`

## 3. Integration smoke (staging project)

Use a test project on Free Cloud:

1. Seed 50 `diagnoses` usage events in the current billing window (non-shadow).
2. Submit a report that passes Haiku fast-filter.
3. **Expect:** `classify-report` returns **402** with `SPEND_CAP_REACHED` or quota reason **before** Sonnet is invoked.
4. **Verify:** No new Sonnet token usage in `sdk_assistant_messages` / provider logs for that report.

Repeat on Indie with spend cap forced to minimum and overage usage pushed to cap.

## 4. Console UX

- [ ] Billing page shows diagnoses used / limit and spend cap controls
- [ ] At hard stop, admin shows clear "quota exhausted" state — not a generic 500
- [ ] Usage alert emails fire at 50% / 80% / 100% (does **not** replace hard stop)

## 5. Stripe wiring

- [ ] `stripe-bootstrap.mjs` lookup keys match `pricing_plans` IDs
- [ ] Metered overage posts `diagnoses` events only after successful Stage-2
- [ ] Checkout webhook sets `billing_subscriptions.plan_id` to `indie` / `pro`

## 6. Launch decision

| Gate | Pass criteria |
| ---- | ------------- |
| Hard stop | 402 before LLM when at free limit or spend cap |
| Alerts | Email at thresholds; independent of stop |
| Docs | [pricing.mdx](../apps/docs/content/pricing.mdx) matches `VISION.md` §2.2 |
| CI | `pnpm check:narrative` green including `check:license` |

**Sign-off:** Kenji · date: ___________
