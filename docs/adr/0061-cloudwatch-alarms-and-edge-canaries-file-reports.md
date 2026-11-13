# 0061. CloudWatch alarms arrive by SNS, and edge canaries check what a browser cannot

Status: Accepted 2026-11-13 (owner: "integrated with mushi", "please proceed
and complete"). Extends [ADR 0024](0024-live-site-watch-files-broken-pages-as-reports.md)
and [ADR 0059](0059-site-watch-loads-a-marked-page-list-not-a-crawl.md);
filing follows [ADR 0029](0029-site-watch-files-a-page-only-after-a-second-failure.md).
Date: 2026-11-13

Related: `webhooks-cloudwatch/index.ts`, `_shared/sns-verify.ts`,
`_shared/cloudwatch-ingest.ts`, `_shared/cloudwatch-webhook.ts`,
`_shared/edge-canary.ts`, `site-watch-poll/index.ts`, migrations
`20261113114348` and `20261113114507`.

## Context

The kensaur.us CloudFront distribution (E246VQ1C9QYZVB) has CloudWatch
alarms on its 5xx rate and on Lambda@Edge limit errors. They publish to an
SNS topic that only reached email. #1095 fixed a slash redirect that dropped
the query string; nothing would have noticed it break again, because the
live-site watch loads pages through Firecrawl's browser, which follows every
redirect and cannot see a 301's Location.

## Decision

- **CloudWatch alarms through SNS.** A new edge function `webhooks-cloudwatch`
  (verify_jwt false) takes SNS HTTPS deliveries. The SNS signature is the
  auth:
  - the TopicArn must be bound to a project
    (`project_settings.cloudwatch_sns_topic_arn`); the topic picks the
    project, never the request;
  - SigningCertURL must be https on exactly `sns.<topic region>.amazonaws.com`;
  - SignatureVersion 1 (SHA1) or 2 (SHA256) is verified over the canonical
    string AWS documents for each message type, with WebCrypto on the key
    read from the certificate;
  - the Timestamp must be within an hour, and a MessageId already accepted
    answers 200 without being applied again.
  - The message type comes from the signed `Type`, never the header.
  - SubscriptionConfirmation GETs SubscribeURL only after the signature
    checks, and only on that SNS host for that topic.
- **One report per alarm** (`source = 'cloudwatch'`, `cloudwatch_alarms`):
  - ALARM files a report, or dedupes onto the open one, so a flapping alarm
    never spams the queue;
  - ALARM after the report was closed reopens it and counts a regression;
  - OK annotates the report and leaves it open. A cleared alarm means the
    symptom went quiet, not that someone fixed it, as with Sentry's
    auto-resolve and ADR 0024's "its report is left for the user";
  - a transition older than the last one applied is dropped, because SNS
    does not keep order.
  - Any other message on the topic gets 200 "ignored" and files nothing.
    That covers a budget notice or a plain-text publish.
- **Edge canaries** (`edge_canaries`). Each one is a URL, the statuses that
  pass and, optionally, the exact Location a redirect must send.
  - site-watch-poll's hourly cron pass fetches each URL once, with
    `redirect: 'manual'` and the MushiSiteWatch User-Agent. No page script
    runs and nothing goes through Firecrawl.
  - A failure is fetched again 3 s later. A canary files when it fails in two
    runs in a row (ADR 0029), as a `site_watch` report
    (`custom_metadata.source = 'edge_canary'`).
  - Five or more canaries of one app filing together become one report.
  - Passing again resets the streak and leaves the report for a person.

## Rejected

- **A route in `api`.** `api` is about 4.4 MB against a 5 MB deploy cap and is
  redeployed from master every night, so a branch deploy would vanish. A
  small function has the same posture as `webhooks-linear`.
- **Porting `packages/adapters/src/cloudwatch.ts`.** It allows any
  `sns.*.amazonaws.com` host, trusts the unsigned message-type header and
  never confirms a subscription.
- **Linking alarms through `report_external_issues`.** That table drives the
  outbound tracker resolve loop (`resolveExternalIssue`). An alarm needs its
  own state (last StateChangeTime, counts).
- **Canaries as site-watch pages or site-audit rules.** Both load pages
  through Firecrawl, which follows redirects.
- **Resolving the report on OK.** A cleared alarm is not a fix.

## Consequences

- Canaries cost no credits: one GET per canary an hour, plus one re-check
  per failure.
- Canaries are configured as rows (SQL). There is no console screen yet.
- A canary only runs once its row exists and site-watch-poll has deployed
  from master.
