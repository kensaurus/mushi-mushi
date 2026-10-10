# Billing

Source: https://kensaur.us/mushi-mushi/docs/admin/billing

---
title: Billing
description: The Billing page shows your diagnosis quota, usage alerts at 50% and 80%, your projected bill, and spend caps for your Mushi plan.
---

# Billing

**Route:** `/billing`

> **Scenario:** It's the 20th of the month. You get an email at 50% of your diagnosis quota, then again at 80%. You want to know when you'll hit the wall, what your projected bill is, and how to cap spend — without logging into Stripe.

Everything you need to manage your subscription is on this page: live usage with forecast and projected cost, plan comparison, invoices, spend caps, and in-console support.

---

## Reading your usage card

Each project has a billing card. The key element is the **usage bar**:

```
Diagnoses used: ████████░░░░  85%  (425 / 500)
```

Below the bar you will see:

| Element | What it tells you |
|---|---|
| **Forecast chip** | At current pace, the date you'll hit your included quota |
| **Projected cost** | Estimated monthly bill at current pace (paid tiers with overage) |
| **Quota resets in N days** | Days until your Stripe billing period ends |

**What happens at 100%?**

- **Free Cloud:** New reports are captured but **not diagnosed** until the period resets.
- **Indie / Pro (monthly):** Overage continues until your **spend cap** pauses Stage-2 classification. No reports are lost.
- **Indie / Pro (annual):** No overage. Stage-2 classification pauses at the included diagnoses until the next calendar month. No reports are lost.

### Usage breakdown

| Metric | What it measures |
|--------|-----------------|
| **Diagnoses · period** | Completed Stage-2 classifications this billing cycle |
| **Spend cap · month** | Hard USD ceiling on overage (editable below the bar) |
| **Subscription status** | `active`, `past_due` (update card), `canceled` |
| **Period end date** | When your current billing cycle resets |
| **Fix count** | How many fix-worker runs this month |
| **Classifier tokens** | LLM tokens used by the classifier pipeline |
| **LLM cost** | Estimated AI spend from your BYOK keys |

The **30-day sparkline** shows daily report volume — useful for spotting a spike that will push diagnoses over quota.

---

## Predictability controls

On each paid project card, **Predictability controls** let you:

1. **Monthly spend cap (USD)** — override the plan default ($50 Indie, $200 Pro). Diagnoses pause gracefully at the cap.
2. **Usage alert email** — where 50% / 80% / 100% quota alerts are sent (defaults to project owner).

Both settings save immediately via the Billing API. Leave the cap blank to revert to the plan default; leave the email blank to use the owner address.

  Alerts are deduplicated — at most **one email per threshold per billing month**. The usage-alerts cron runs hourly.

---

## Upgrading your plan

1. Click **Upgrade** on the project card.
2. Pick **Monthly** or **Annual** (about two months free), then **Select** the plan you want.
3. Complete payment in **Stripe Checkout**.
4. The new plan activates when you return to Mushi.

## Changing plan

A project that already pays switches in the console, not in Checkout:

1. Click **Change plan** on the project card.
2. Choose Indie or Pro, monthly or annual. The current choice shows as **Current plan**.
3. The dialog shows what Stripe charges now (or credits) for the prorated difference. Click **Confirm change**.

The change applies immediately. Moving between monthly and annual starts a new billing period that day. If the card is declined, nothing changes. Annual plans have no overage and stop at the included diagnoses each month. Enterprise is arranged with our team — use **Email sales** on the Plans tab.

---

## Managing payment and invoices

Click **Manage** to open the **Stripe Billing Portal**. Plan changes happen in **Change plan** above; Stripe's portal cannot switch a subscription that has metered usage. Use the portal for:

- Updating your credit card
- Viewing upcoming invoices
- Cancelling a subscription
- Downloading invoice PDFs

The **Invoices table** on this page shows recent hosted invoice links.

---

## CLI parity

```bash
mushi usage              # diagnoses used / limit this period
mushi billing status     # plan, usage, cap, overage rate
mushi billing cap        # show current spend cap
mushi billing cap 100    # set $100/mo hard cap
mushi billing cap 0      # clear override → plan default
```

---

## Related docs

- [Public pricing](/pricing) — plan table, estimator, example bills, FAQ
- [Self-hosting](/self-hosting) — unlimited diagnoses with your own LLM key
