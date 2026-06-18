# North star — bug translation for vibe coders

Internal canon (Jun 2026). Public surfaces import copy from `@mushi-mushi/brand`
and [`docs/marketing/VOICE.md`](../marketing/VOICE.md).

## One line

> **It's the thing that tells you why your AI-built app broke — in your editor, in plain English, with the fix ready to paste — so a bug costs you five minutes instead of your whole afternoon.**

## Category

**Bug translation** — the layer between *an error happened* and *here's the prompt that fixes it.*

Not error monitoring. Not observability. Those signal ops burden to the vibe-coder buyer.

## Primary surface

**MCP-first** inside Cursor / Claude Code. Standalone SDK capture is the front door for reports; MCP is the front door for comprehension.

## What we are / are not

- Plain-English diagnosis + paste-ready fix prompt
- MCP-native: agent pulls the answer, human never context-switches
- Works with existing trackers (Sentry enrichment = upgrade reveal, not hero)
- Not a full observability platform
- Not a testing-discipline lecture

## Shipped vs target (docs honesty)

| Capability | Status |
|------------|--------|
| MCP `get_fix_context` + `summarize_report_for_fix` | **Shipped** |
| No second LLM vendor key for MCP | **Shipped** |
| SDK + wizard (`npx mushi-mushi`) | **Shipped** |
| Optional draft PR via `dispatch_fix` | **Shipped** (opt-in) |
| Sub-10-second diagnosis SLA | **Target** |
| Dedicated fix-prompt generator tool | **Target** (prompt exists today) |
| Accountless / zero-signup install | **Target** |

## Phase-1 GTM metric

**Time-to-first-diagnosis after install** — target under ~2 minutes before scaling reach.
