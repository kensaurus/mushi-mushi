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

**First on the page:** one line naming the accounts that need a look, worst first ("3 accounts need a look: OpenAI is down, fal.ai is not checked, ElevenLabs is off."), with **Turn on** for an account that is off. Beside it: accounts working as a bar, how many need a look, and open incidents.

- **Providers:** one row per provider account, worst first, each state a glyph and a plain word: ✕ Down, ⧗ Warning, ✓ Working, ◷ Not checked lately, ○ Not checked, ⊘ Off. Each row shows its balance or quota bar; with no balance it says why ("key check only" when the account's check only tests its key). **Used by** is one chip per app with its icon; hover a chip for the features that app calls the account for.
  - An account that is off says so in one line with **Turn on**.
  - An unchecked account says so in one line: the provider watch on kenji has no reading for it yet. Its health check is set up on kenji, so there is no button.
- **Spend:** what each app's AI calls cost against what the app sells, with the margin as ▲/▼.
- **Routes:** the models each app tries, in order. Toggle, reorder or edit a route; a change that would leave an app with no enabled default route is refused.
- **History:** every change, who made it, and when.
