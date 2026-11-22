# 0063. Reach first: a wider free plan, uncapped BYOK, and self-host with every feature

Status: Accepted 2026-11-19 by the owner (delegated to the lead). Date: 2026-11-19

Related: `packages/server/supabase/migrations/20261119090000_free_plan_reach_first.sql`,
`_shared/quota.ts` `byokLiftsFreeCap`, `_shared/byok.ts` `projectHasOwnLlmKey`,
`packages/cli/src/commands/selfhost.ts`, ADR [0036](0036-licensing-posture.md)
(licensing posture), ADR [0058](0058-one-stop-platform-to-enhance-vibe-coded-apps.md)
(positioning), `docs/gtm/directory-submissions.md`, `VISION.md` ("self-host is
free and complete").

## Context

On 2026-11-19 the owner said: "anything to increase user reach, visibility, user
takeup, acquisition is priority - profit and money making can come later. enhance
fully and decide for me based on research."

What we measured:

- **No outside activation yet** (growth diagnosis, 2026-11-14). The first wall a
  new user hit was the free plan's one app: vibe coders run several small apps.
- **A hosted diagnosis costs about $0.012.** `llm_invocations`, last 30 days:
  classify-report $0.0071 average (p90 $0.022), fast-filter $0.0008, judge
  sampling $0.0036. 100 diagnoses is about $1.20; 300 is about $3.60 for an org
  that uses all of it. The month's largest LLM line was internal PR review
  ($204), not users.
- **BYOK diagnoses were capped too.** A free project with its own Anthropic or
  OpenAI key stopped at 100 diagnoses although the owner paid nothing for them.
- **Benchmarks read 2026-11-19.** Langfuse Hobby: free, no card, 30 days of data,
  2 users ([langfuse.com/pricing](https://langfuse.com/pricing)). Sentry
  Developer: free, 5k errors, 1 user
  ([sentry.io/pricing](https://sentry.io/pricing/)). Both gate retention, seats
  and support, not core features.
- **Self-host fell to the Cloud Free plan** before this batch: 100 diagnoses, one
  app, no plugins. `packages/server/ee/` holds a licence file and no code, so
  nothing self-host turns on is proprietary.

## Decision

1. **Free plan (`free_cloud`):** 3 apps (was 1), 300 diagnoses a month (was 100),
   30-day retention (was 14), marketplace plugins and usage alerts on. One seat,
   no card, a hard stop at the cap for diagnoses on Mushi Mushi's key.
2. **BYOK is never capped on Free.** `byokLiftsFreeCap` lifts only the free
   plan's cap (`NO_SUBSCRIPTION_OVER_FREE`) when the project's first Anthropic or
   OpenAI key is its own. Paid overage and spend caps are unchanged.
3. **Self-host turns everything on.** `mushi selfhost up`, compose and Helm lift
   every plan limit and turn on the core feature flags (byok, sso, plugins,
   intelligence_reports, audit_log, self_hosted, teams). `inventory_v2` and
   `soc2` stay off because they start background jobs; an operator turns them on.
4. **Paid plans keep their prices.** Builder and Studio still differ from Free by
   diagnoses (1,000 / 3,000), retention (90 / 180 days), seats, audit log, support
   and overage with a spend cap.
5. **Distribution:** list the hosted MCP server everywhere a builder looks.
   Opened 2026-11-19: punkpeye/awesome-remote-mcp-servers#5135 and
   docker/mcp-registry#7331. Already listed: the official MCP registry
   (`io.github.kensaurus/mushi-mushi`), Glama, awesome-mcp-servers (#8625). The
   Claude Connectors Directory and Cursor Marketplace need the owner's own
   sign-in; the kit is `docs/gtm/directory-submissions.md`.

## Consequences

- Worst-case new LLM spend is about $3.60 per active free org a month. Watch it
  in `llm_invocations` grouped by plan; if free spend passes $50 a month, lower
  the cap again with a new ADR, not a silent change.
- A BYOK call that fails over to Mushi Mushi's env key is billed to the owner.
  That path is rare (the BYOK key is tried first) and accepted for now.
- Every surface that states the free plan says 3 apps, 300 diagnoses, 30 days
  (README, docs pricing, compare pages, terms, console copy, directory kit).

## Rejected

- **Unlimited free diagnoses on Mushi Mushi's key.** No cap means unbounded spend
  from one scripted signup; 300 already covers a real small app.
- **Keeping SSO or audit log paid on self-host.** It contradicts VISION.md and
  ADR 0036, and an operator can patch the flags anyway. The paid line is hosted
  convenience, retention and support.
- **More seats on Free.** Seats gate the team features (`teams` is off on Free);
  raising them needs a team-plan design, not a number change.
