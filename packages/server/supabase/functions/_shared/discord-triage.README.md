# Centralised Discord triage

`discord-triage.ts` funnels notable reports from **every** project into a
single Discord channel so one human can triage the whole kensaurus fleet in one
place. Each app embeds the SDK with its own `MUSHI_PROJECT_ID`; this module is
the operator's cross-project firehose.

## This is not the per-project path

| | `discord.ts` | `discord-triage.ts` |
| --- | --- | --- |
| Audience | The customer's own team | The operator (one channel, all projects) |
| Configured by | `project_settings.discord_webhook_url` | Edge secrets |
| Format | Rich embed | One compact text line |
| Honours `notification_prefs` | Yes | **No** — see below |

The triage feed deliberately ignores a project's `notification_prefs`
(`report.classified`, `report_severity_min`). Those exist so a customer can
quiet *their* channel; letting them also silence the operator feed would mean a
muted project's outages became invisible. The triage feed has its own,
env-owned floor instead.

## Env vars

Set as edge secrets on the `mushi` project
(`npx supabase secrets set … --project-ref dxptnwrhwsqckaftyymj`). Two
transports; the first configured one wins. With neither set the module is a
silent no-op, so self-hosters and CI never post.

| Var | Mode | Notes |
| --- | --- | --- |
| `MUSHI_DISCORD_WEBHOOK_URL` | webhook | Standard Discord incoming webhook. |
| `MUSHI_DISCORD_THREAD_ID` | webhook | Optional. Appended as `?thread_id=`; webhooks can post into, but not create, threads. |
| `MUSHI_TRIAGE_RELAY_URL` | relay | Endpoint of a bot-token relay accepting `{content, thread}`. |
| `MUSHI_TRIAGE_RELAY_TOKEN` | relay | Sent as the `x-relay-token` header. |
| `MUSHI_TRIAGE_RELAY_THREAD` | relay | Optional. Defaults to `support`. |
| `MUSHI_DISCORD_MIN_LEVEL` | both | Severity floor. Default `error`. |
| `ADMIN_BASE_URL` | both | Already used elsewhere; supplies the `/reports/:id` deep link. |

Relay mode targets `tsumagoi-kensaurus-sales-relay`, which exists for channels
where the bot lacks `MANAGE_WEBHOOKS`, so no plain webhook can be minted and a
bot-token holder has to post on our behalf. Reusing it means mushi needs no
Discord credentials of its own — just the relay URL and token.

`thread` is load-bearing. That relay routes `thread === 'support'` to
`DISCORD_SUPPORT_THREAD_ID` and **anything else, including an absent field**,
to the sales thread — so omitting it would file bug reports into `#llm-sales`.
This module always sends it, defaulting to `support` (the `kensaurus-support`
thread the payment-support path already posts to).

## What triggers a post

A report is announced **once**, on first sighting, from whichever stage
classified it:

- **`fast-filter`** — the Stage 1 terminal branch (`stage1_final`), taken when
  classifier confidence clears `stage1_confidence_threshold`. These reports
  never reach Stage 2.
- **`classify-report`** — everything else, after Stage 2 assigns the final
  severity, summary, and component.

The two are mutually exclusive branches of the same pipeline, so they cannot
double-post.

Recurring issues are then re-announced only at **10, 100, and 1000**
occurrences. Duplicates in between are silent. The count is the true blast
radius from the `report_group_blast_radius` RPC — not
`report_groups.report_count`, which is only ever set to `similar.length + 1`
with `similar` capped at 3 and so is not a running total.

Grouping runs fire-and-forget during Stage 1, so a brand-new report often still
has a null `report_group_id` at notify time. That is treated as a first
sighting and announced, which is the intended default: a duplicate line costs
less than a missed outage. For the same reason, any failure looking up the
blast radius falls through to notifying.

A report that *is* the group's `canonical_report_id` also counts as a first
sighting regardless of the count. This closes a race: when two similar reports
arrive close together, the second one's grouping pass backfills a group id onto
the first report, sometimes before that first report's own notify reads it.
Counting alone would see 2 and suppress both, leaving the issue silent until
×10. (`canonical_report_id` is the top similarity match at group creation, not
strictly the earliest member — but in the two-report race it is the earlier
one, which is what makes this work.)

## Message shape

```
❗ **high** · `yen-yen` · bug
Checkout button does nothing on the payment step
component: CheckoutForm · user: `a3f19c` · ×10
https://console.example.com/reports/8f2c…
```

`user` is the first 6 hex chars of SHA-256 over the report's `end_user_id`,
`reporter_user_id`, or `reporter_token_hash` — stable enough to see "same
person again", non-reversible, and never an email or raw id. Nothing else from
the report body is posted; the deep link is how you get the detail.

## Changing the threshold

`MUSHI_DISCORD_MIN_LEVEL` accepts this repo's report severities — `low`,
`medium`, `high`, `critical` — plus log-style aliases for readability:
`fatal`→`critical`, `error`→`high`, `warn`/`warning`→`medium`,
`info`/`debug`→`low`.

The default `error` therefore resolves to `high`, so only `high` and `critical`
reports reach Discord. Set it to `medium` for a busier feed, or `critical` for
pager-only. An unrecognised value logs a warning and falls back to the default
rather than silently disabling the filter.

To change the escalation points, edit `ESCALATION_THRESHOLDS` in
`discord-triage.ts` — they are intentionally code, not config, because they
change roughly never.

## Failure behaviour

Delivery is fire-and-forget with a hard 2s `AbortController` timeout, so a slow
or dead Discord can add at most 2s to a background task and never fails
classification. Every path returns a boolean rather than throwing; problems
surface as `discord-triage` warnings in the function logs.

Both call sites register the work through `detachTriage`, which hands the
promise to `EdgeRuntime.waitUntil`. This is load-bearing: Supabase tears the
isolate down once the handler's Response resolves, and a triage post is several
round trips (group lookup, blast radius, Discord fetch). A plain detached
promise would be dropped mid-flight with no error and no log — the message
would just never arrive. `detachTriage` falls back to a bare `void` when
`EdgeRuntime` is absent so local `supabase functions serve` still works.
