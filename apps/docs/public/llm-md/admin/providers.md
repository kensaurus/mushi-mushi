# Providers & AI routes

Source: https://kensaur.us/mushi-mushi/docs/admin/providers

---
title: Providers & AI routes
description: Operator-only page in the Mushi Mushi console showing each app's AI provider accounts, their health and spend, and the ordered model routes each app tries.
robots:
  index: false
  follow: true
---

# Providers & AI routes

**Route:** `/providers` (operators only; other accounts never see it)

- **Providers:** one row per provider account, worst first: ✕ down, ⧗ warn, ✓ ok, ◷ stale. Each row shows its balance or quota bar.
- **Spend:** what each app's AI calls cost against what the app sells, with the margin as ▲/▼.
- **Routes:** the models each app tries, in order. Toggle, reorder or edit a route; a change that would leave an app with no enabled default route is refused.
- **History:** every change, who made it, and when.
