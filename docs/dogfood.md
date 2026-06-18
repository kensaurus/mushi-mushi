# Dogfood — Mushi on Mushi

Mushi runs on its own infra and on sibling products in the suite. The examples
below are **real captures** from the hosted project `dxptnwrhwsqckaftyymj`, not
invented — each links to the public PR or report it produced.

## Targets

| Product | Status | Evidence |
|---------|--------|----------|
| Mushi admin + edge functions | Active | `classify-report`, `fix-worker`, MCP all on the same stack; live PDCA run below |
| yen-yen | Active — 35 reports, 29 classified, 6 fix PRs | PRs [#67](https://github.com/kensaurus/yen-yen/pull/67)–[#70](https://github.com/kensaurus/yen-yen/pull/70) |
| glot.it | Active — 18 reports, incident-loop verified | PR [glot.it#12](https://github.com/kensaurus/glot.it/pull/12) |

## Mushi runs on Mushi

A full Plan → PR loop run against the production project on 2026-04-23
([live-pdca-run.md](audit-2026-04-23/live-pdca-run.md)):

- **Report → classified** in 4.0 s (`severity=high`, `confidence=0.95`, `stage1_model=claude-haiku-4-5`).
- **Plan → draft PR** ([glot.it#12](https://github.com/kensaurus/glot.it/pull/12)) end-to-end in **~18 seconds** — faster than our own README's "P50 ≤ 60 s" claim.
- The run *also* surfaced a real P0 in Mushi's own cron layer (`current_setting('app.settings.service_role_key')` returning NULL → six scheduled jobs silently failing). Mushi diagnosed its own infra.

## Real before → after (yen-yen)

Each row is a real user report. **Before** is what the tester typed; **after**
is Mushi's plain-English diagnosis (Stage-2 `summary`, with severity +
confidence). The PR is the paste-ready fix prompt turned into a draft.

| Before (what the user said) | After (Mushi's diagnosis) | Severity · confidence | Fix |
|---|---|---|---|
| "The balance continues to display the old converted value…" | Wallet screen balance does not refresh after a currency swap until the app is fully restarted. | high · 0.95 | [#69](https://github.com/kensaurus/yen-yen/pull/69) |
| "The fixed header covers the first transaction row…" | Header stays fixed and covers the first transaction row when scrolling on Transactions; content clipped under sticky chrome on iOS + Android. | high (visual) · 0.95 | [#68](https://github.com/kensaurus/yen-yen/pull/68) |
| "The wishlist item row vanishes from the list view…" | Wishlist items disappear from the list view when navigating back from item detail, even though the rows still exist in the database. | high · 0.95 | [#70](https://github.com/kensaurus/yen-yen/pull/70) |
| (inbox renders empty) | FeedbackInboxScreen renders an empty list despite the API returning data — likely state not updated after async load. | high · 0.82 | [#67](https://github.com/kensaurus/yen-yen/pull/67) |

## glot.it — incident loop + SDK self-verification

glot.it both *uses* Mushi and *verifies the SDK against itself*. Real classified
reports include the incident-loop run (PR #12 above) plus SDK capture
self-checks — e.g. "SDK 1.7.6 auto-screenshot on-report feature not verified —
viewport capture not attached at submit time" (`medium · 0.62`), where Mushi
honestly lowered its own confidence rather than claim a confident-but-wrong fix.

## How these are captured

For each dogfood incident we record:

1. Report ID (redacted in public docs; full ID in the audit logs)
2. Time from report → `classified` and → draft PR
3. The one-line plain-English diagnosis (`summary`)
4. Whether the paste-ready prompt fixed it in one Cursor turn (PR link)

Refresh the numbers any time:

```bash
node scripts/dogfood-mushi-pipeline.mjs   # glot.it ↔ Mushi two-way loop checklist
```

These become README/demo assets per [`docs/marketing/STOREFRONTS.md`](marketing/STOREFRONTS.md).
