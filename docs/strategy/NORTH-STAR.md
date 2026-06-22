# North star — the comprehension layer for AI-built apps

> **Canonical source of truth:** [`/VISION.md`](../../VISION.md) (the constitution).
> This file is the internal working notes layer: it carries the *shipped vs.
> target* honesty table and the Phase-1 GTM metric. When this file and
> `VISION.md` disagree on identity, **`VISION.md` wins** — update this file, not
> the other way around.

Public surfaces import copy from `@mushi-mushi/brand` and
[`docs/marketing/VOICE.md`](../marketing/VOICE.md). Those, in turn, compress the
north-star sentence below.

## One line

> **Your AI shipped it. Mushi tells you why it broke — in plain English, in your
> editor, with the fix ready to go — so a bug costs you five minutes instead of
> your whole afternoon.**

## Category

**The comprehension layer for AI-built apps** — the layer that makes a bug
*understandable*: between *an error happened* and *here's the fix ready to paste*.

Not error monitoring. Not observability. Not a "synthesis layer / integration
hub." Those signal ops burden to the vibe-coder buyer, or assume they already
run a monitoring stack. The word is **understandable**.

## Primary buyer

The solo / indie **vibe coder** who builds fast with AI and loses whole
afternoons when something breaks. Small teams/agencies are secondary. The
enterprise SRE is explicitly *not* who we lead with. See `VISION.md` §1.4.

## Primary surface

**MCP-first** inside Cursor / Claude Code. Standalone SDK capture is the front
door for reports; MCP is the front door for comprehension. Standalone-first —
Sentry enrichment is the upgrade reveal, never the hero.

## What we are / are not

- Plain-English diagnosis + paste-ready fix prompt
- MCP-native: agent pulls the answer, human never context-switches
- Works standalone with no Sentry required (enrichment = upgrade reveal)
- Not a full observability platform
- Not an enterprise integration hub
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

**Time-to-first-diagnosis after install** — target under ~2 minutes before
scaling reach.
