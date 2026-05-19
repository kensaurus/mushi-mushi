---
"@mushi-mushi/core": minor
"@mushi-mushi/web": minor
"@mushi-mushi/react": minor
"@mushi-mushi/react-native": minor
"@mushi-mushi/capacitor": minor
"@mushi-mushi/mcp": minor
"@mushi-mushi/vue": patch
"@mushi-mushi/svelte": patch
"@mushi-mushi/angular": patch
"@mushi-mushi/cli": minor
"@mushi-mushi/plugin-sdk": patch
"@mushi-mushi/plugin-sentry": patch
---

Release the full SDK + closed-loop evolution backlog since v0.5.0
(`cf27d81`, 2026-05-10). Covers headless SDK, QA Coverage Suite,
rewards program, native 0.4.0 parity, closed-loop Phases 0–6, and
operator UX hardening for beta users.

### Headless SDK (minor — core / web / react / react-native)

`MushiTrigger` (React + React Native) and `MushiAttach` (React) — wrap
any element or DOM selector to trigger the Mushi widget without the
floating button. The matching `SdkInstallCard` in the console now
generates copy/paste snippets for both patterns.

### QA Coverage Suite (minor — core / web)

Automated user-story tests run on cron through Playwright, Browserbase,
or Firecrawl. Ships with `qa_stories` / `qa_story_runs` /
`qa_story_evidence` schema, the `qa-story-runner` edge function, a
pluggable browser-provider abstraction, and the full admin UI
(`QaCoveragePage` + `QaCoverageTile`).

### Rewards program (minor — core / web / react / react-native)

End-user rewards across all layers: configurable point rules,
GDPR export, Stripe Connect payouts (Enterprise-gated), multi-step
quests, SDK activity batching + tier badges, MCP catalog tools
(`list_top_contributors`, `award_bonus_points`, `set_tier`).

### Closed-loop evolution — CLI + MCP (minor)

- **`mushi sync-lessons`** — pulls promoted lessons from
  `/v1/admin/lessons` and writes `.mushi/lessons.json` into the
  connected repo (supports `--dry-run` and `--json`). Designed for
  CI and scheduled refresh PRs.
- **MCP** — `lessons.query(diff_text, max_tokens)` tool for
  token-budget-ranked lesson injection into agent / PR-review flows;
  expanded catalog surface for Migration Hub and closed-loop resources.

### Native parity (Capacitor minor; iOS/Android via Cocoapods/Maven)

Capacitor re-exports `addBreadcrumb` / `getBreadcrumbs` and the 0.4.0
native parity modules (BreadcrumbCollector, ProactiveDetector,
PIIScrubber, ExceptionNormaliser). iOS/Android SDKs ship at 0.4.0 via
native package managers — not npm.

### Plugin packaging (patch)

PR #98 fixed six plugin packages that shipped with `workspace:*`
instead of `workspace:^`, which broke `npm install` for end users.

### Patch surfaces

- `@mushi-mushi/{vue,svelte,angular}` — re-export headless trigger helpers.
- `@mushi-mushi/plugin-sentry` — expanded inbound adapter surface.
- `@mushi-mushi/plugin-sdk` — event schema extensions for rewards +
  experiment hooks.

### Server + admin (not in this npm release)

The following ship via Supabase Edge Functions + admin deploy, not npm:

- Closed-loop Phases 1–6: mistake clustering, releases + credits, PDCA
  iterate loop, contract drift walker, A/B experiments, anomaly detection,
  `/cost` panel.
- Beta banner + structured project-create error UX + personal-org
  bootstrap on signup.
- Seven new admin tabs: `/lessons`, `/releases`, `/iterate`, `/drift`,
  `/experiments`, `/anomalies`, `/cost`.
- Docs: `closed-loop.mdx`, `EvolutionDiagram`, `LoopComparison`.
- `SELF_HOSTED.md` updated with `mushi.edge_function_post()` cron
  patterns (replaces broken `current_setting('app.settings.*')` GUCs).
