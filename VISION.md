# Mushi Mushi — Vision & Positioning (the constitution)

> **This file is the source of truth for what Mushi *is*.** When the README hero,
> the landing page, the npm description, or the pricing page disagree with each
> other, they defer to this file. Nothing ships that contradicts Section 1. If
> Section 1 needs to change, it changes *here first*, deliberately — never by
> drift in a downstream surface.
>
> This is an excerpt (Sections 1 and 2.1) of the full *Mushi Mushi — Full Liftup
> Plan*. The anti-drift system that keeps the surfaces honest lives in
> [`scripts/check-positioning-consistency.mjs`](./scripts/check-positioning-consistency.mjs)
> and the pre-release checklist.

*Owner: Kensaurus 合同会社 · Last ratified: June 2026*

---

## 1. The immovable core — vision, mission, positioning

*This section is load-bearing. Memorize it. It is propagated (compressed) into
the README hero, the landing hero, the npm description, the pitch, and
`AGENTS.md` so even the coding agents stay on-message.*

### 1.1 Vision

**A world where shipping fast doesn't mean understanding slow.** AI lets one
person build what used to take ten. But when it breaks, that same person is
alone with a stack trace for code they didn't really write. Mushi exists to
close that gap — to make *understanding* a bug as fast as *creating* the feature
that caused it.

### 1.2 Mission

**Turn "something broke" into "here's exactly why, and here's the fix" — without
the builder ever leaving their editor.**

### 1.3 The one-sentence north star

> **Your AI shipped it. Mushi tells you why it broke — in plain English, in your
> editor, with the fix ready to go — so a bug costs you five minutes instead of
> your whole afternoon.**

Every surface leads with a compression of this sentence. No surface contradicts
it.

### 1.4 Who it is for (and who it is *not*)

| | |
|---|---|
| **Primary buyer** | The solo / indie **vibe coder** — builds fast with AI (Cursor, Claude Code, Lovable, Bolt), ships to real users, then loses whole afternoons when something breaks because they don't fully grasp the generated code. |
| **Secondary** | Small teams and agencies who feel the same pain at slightly larger scale. |
| **Explicitly NOT (for now)** | The enterprise SRE running Sentry + Datadog + Firebase who wants a fourth integration hub. We may serve them later via the Enterprise tier — but **we do not lead with them, market to them, or shape the README around them.** That audience pulled the product off its wedge once already. |

### 1.5 The category we own

**The comprehension layer for AI-built apps.** Not "error monitoring" (that's
Sentry, and it sounds like ops work). Not "observability" (enterprise-coded,
config-heavy, allergy trigger). Not "synthesis layer / integration hub" (that's
the drift — it requires the reader to already own a monitoring stack).

We are the layer that makes a bug *understandable*. That is the word:
**understandable.**

### 1.6 The wedge against Sentry — exact, current, defensible

Sentry owns "errors your code throws." We do not fight there. We sit where
Sentry is weak for *our* buyer:

- Sentry's free tier caps at **5,000 errors/month**; bill-shock above it is the
  #1 complaint.
- Sentry's AI root-cause (Seer) sits behind the **$80/mo Business plan + ~$40 per
  active contributor** — out of reach for the solo builder.
- Sentry's whole shape is team-and-ops. It assumes you can read the trace.

**Mushi's wedge:** plain-English diagnosis + a ready-to-apply fix, editor-native,
that works **standalone with no Sentry required** — and *also* enriches Sentry if
you already have it. Lead with standalone. Sentry-enrichment is the upsell
reveal, never the front door.

### 1.7 The three things we will not do

1. **We will not require a monitoring stack to get value.** Standalone-first,
   always. If the README ever again assumes the reader runs
   Sentry+Datadog+Firebase, it has drifted.
2. **We will not lead with the integration-hub / enterprise-plumbing story.** It
   can exist in `docs/` for operators who scroll. It never leads.
3. **We will not let the surfaces diverge.** Tagline, vision sentence, and buyer
   are identical across npm, repo, and landing — enforced by the pre-release
   consistency checklist.

---

## 2.1 The three buckets

Everything Mushi has built sorts into three buckets. The **buckets** — not the
feature list — drive each surface. The drift was caused by Bucket C climbing to
the top; the rule is to push it back down. Nothing gets deleted — it gets
*re-shelved*.

| Bucket | What's in it | Where it appears |
|---|---|---|
| **A. The Wedge** (lead with this) | Capture a bug → AI diagnoses it in plain English → ready-to-apply fix → editor-native (MCP) → optional draft PR. Standalone, no Sentry. | README hero, landing hero, npm first paragraph, the GIF, the 60-second quickstart |
| **B. The Depth** (earns trust, shown second) | Multi-framework SDKs, dedup via knowledge graph, "where it stops" honesty table, self-host, BYOK, Sentry enrichment. | README mid-body, landing second screen, `docs/` |
| **C. The Platform** (operators only, never leads) | 11 adapters, 12 plugins, A2A/AG-UI, inventory QA-gates, synthetic monitor, SSO/audit/retention/region, Helm multi-region. | `docs/operators/`, a single "Enterprise / Platform" link. **Removed from the README's first 60% of scroll.** |

### The naming of the wedge feature

The magic moment has a single proper noun so people can refer to it: **"the
diagnosis."** A bug comes in; Mushi produces *a diagnosis* — plain-English root
cause + the fix. This is the unit we meter for quota, the word in the GIF
caption, and the verb in the docs ("Mushi diagnosed it"). One word, everywhere.

### 2.2 Cloud pricing canon (June 2026)

These numbers are the source of truth for docs, billing UI, and quota gates. If a
surface shows different limits, it has drifted.

| Plan | Base | Included diagnoses / mo | Hard stop or overage |
| --- | --- | --- | --- |
| **Free Cloud** | $0 | 50 | **Hard stop** — no overage, no card |
| **Indie** | $15 | 500 | Overage $0.03/diagnosis, default **$50** spend cap |
| **Pro** | $49 | 2,000 | Overage $0.025/diagnosis, default **$200** spend cap |
| **Self-host** | $0 | Unlimited | BYOK — your LLM costs only (typically under $20/mo) |

A **diagnosis** = one completed Stage-2 classification. See
[`apps/docs/content/pricing.mdx`](./apps/docs/content/pricing.mdx) for the full
estimator and FAQ.

---

## The "is this drift?" test for any new feature

Before building or featuring anything, ask: **"Does this help a solo vibe-coder
understand and fix a bug faster, without leaving their editor?"**

- **Yes →** it's Bucket A or B. Can lead.
- **No, but operators need it →** Bucket C. Build it if you want, but it goes in
  `docs/operators/`, never the hero.
- **It only matters to enterprise buyers →** Enterprise tier, gated, never the
  front door.

If a feature can't answer "yes" and you're tempted to put it in the hero anyway
— that's the drift starting. Stop.
