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

- **Routes** (the default tab): what every app tries, and the switches.
  - One status line: each provider the routes use in a word ("OpenAI healthy · OpenRouter no health check yet · 0 open incidents").
  - One card per provider with its health, how many apps try it, 24 h calls and cost, and **Switch off for every app** (or **Switch on**). The confirm names the apps that use it and any feature that would have nothing left to try. A provider with no account on kenji (OpenRouter today) has no health check and no switch.
  - A table of apps × providers: each app's role for each provider in its default order (**Primary**, **Backup**, **Last resort**, **Off**, or — when the default does not use it), with a health mark and 24 h calls and cost. "+14 overrides" counts the features with their own order that try it too. On a phone it is one line per app.
  - **Cheaper model available:** the weekly model check's latest suggestions, each linked to the orders that use the model. Suggestions only; nothing switches by itself.
  - **Fallback orders:** per app, features with the same steps (provider, model, settings, on/off, in order) share one line, for example glot.it's 42 features in 6 lines. Open a line to edit it in a drawer: move steps up or down, switch a step's model (priced models only, with input and output price per 1M and a size), turn a step on or off, remove one or add one. **Review changes** shows the order before and after; **Save** applies it to every feature on that line, one audited change at a time. If the order changed since you opened it, nothing is saved. If one change is refused, the save stops there and says which features changed. The default order always keeps one step turned on.
- **Providers:** one row per provider account, worst first, each state a glyph and a plain word: ✕ Down, ⧗ Warning, ✓ Working, ◷ Not checked lately, ○ Not checked, ⊘ Off. Each row shows its balance or quota bar; with no balance it says why ("key check only" when the account's check only tests its key). **Used by** is one chip per app whose routes try that provider (from the routes themselves); hover a chip for the features.
  - An account that is off says so in one line with **Turn on**.
  - An unchecked account says so in one line: the provider watch on kenji has no reading for it yet. Its health check is set up on kenji, so there is no button.
- **Spend:** what each app's AI calls cost against what the app sells, with the margin as ▲/▼.
- **History:** every change, who made it, and when.
