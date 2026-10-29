# Sentry

Source: https://kensaur.us/mushi-mushi/docs/plugins/sentry

---
title: Sentry
description: Two-way Sentry integration. Sentry errors land in the Mushi Mushi queue, merging a fix resolves the issue, and an optional plugin copies triaged reports back.
---

# Sentry plugin

Two-way Sentry integration: Sentry errors flow **into** the Mushi Mushi queue,
and fixes flow **back**. Merging a fix resolves the linked Sentry issue, and
resolving in Sentry resolves the linked report. The outbound plugin below
also copies triaged Mushi reports into Sentry.

## Route Sentry errors into Mushi Mushi (inbound)

No plugin needed. This is built into the hosted API:

1. In Sentry: **Settings → Developer Settings → Custom Integrations → Create
   New Integration → Internal Integration**. Set its webhook URL to the
   **Receive URL** shown on the Mushi Sentry card
   (`/v1/webhooks/sentry?projectId=<your-project-id>`), subscribe to the
   **issue** resource, enable **Alert Rule Action**, and give it **Issue &
   Event: Read & Write**.
2. In the Mushi console, open **Integrations → Sentry** and paste the integration's
   **Client Secret** as the **Webhook secret**, plus your org slug, project
   slug and auth token. Sentry signs every delivery with that secret
   (`Sentry-Hook-Signature`, HMAC-SHA256 of the body); Mushi also requires a
   fresh `Sentry-Hook-Timestamp` and drops a `Request-ID` or body it already
   accepted.
3. To route alerts too: **Alerts → Create Alert Rule** (issue alert) → action
   **Send a notification via** your internal integration.
4. Fire a test alert. The error lands in **Reports** with a `via Sentry` badge,
   a plain-English diagnosis, and a dispatchable fix.

Issues that already exist never fire again. Pull them in with **Import** on
the Sentry card, the `import_sentry_issues` MCP tool, or
`POST /v1/admin/projects//sentry/import` with
`{ "issueIds": ["WEB-12"] }` (ids or short ids, at most 10) or
`{ "query": "is:unresolved", "limit": 5 }`.

For a whole backlog, add `"sinceDays": 30` and `"limit": 10`, then send the
`nextCursor` from each answer back as `"cursor"` until it comes back `null`.
Running it again is safe: issues already imported answer `linked`. If one app
reports to two Sentry projects (say a frontend and a backend), list the second
in `sentry_extra_project_slugs` and pick it with `"sentryProject"`.

In the console, all of this is on the Sentry card:

- **More Sentry projects** (edit the card) takes up to 10 extra project slugs,
  comma-separated. It saves `sentry_extra_project_slugs`; clearing the field
  removes them. Over the API, send a string array to
  `PUT /v1/admin/integrations/platform/sentry`
  (`{ "sentry_extra_project_slugs": ["sbc-be"] }`; `[]` or `null` clears it).
- **Import existing Sentry issues** has a Sentry project picker (shown when
  more than one project is configured) and a **Seen in** choice (any time, or
  the last 7, 14, 30 or 90 days). A windowed search imports 10 at a time;
  **Load next page** repeats the same search from where the last page ended
  until Sentry has no more.

Behavior:

- **Deduped per Sentry issue**: repeat alerts land on the same report;
  re-importing a linked issue returns the existing report.
- **Regressions reopen**: an alert for an already-fixed report flips it to
  `reopened` and bumps the regression counter instead of filing a duplicate.
- **Resolves both ways**: when a Mushi fix PR merges, Mushi resolves the
  linked Sentry issue through the Sentry API (`resolvedInNextRelease`, else
  `resolved`) and comments the PR link; the fix commit also carries
  `Fixes <SHORT-ID>` for Sentry's GitHub integration. A failed resolve shows
  on the fix timeline. `action: resolved` from Sentry resolves the linked
  Mushi report.
- **Fix context**: the files named in an imported issue's stack are indexed
  right away, and codebase sweeps index stack-frame files of open
  Sentry-linked reports first.
- Your Sentry **alert rules are the noise filter**: only alerts you route at
  the webhook are ingested. Sentry User Feedback submissions are also ingested
  on the same endpoint.

## Copy Mushi Mushi reports into Sentry (outbound plugin)

Everything above is built in. The plugin is only for the other direction:
copying the bugs your users report through Mushi into Sentry, so they sit
next to your Sentry errors. You run it on your own server.

1. Start the plugin where Mushi can reach it over public HTTPS:

   ```bash
   npm i @mushi-mushi/plugin-sentry
   export MUSHI_PLUGIN_SECRET=...   # must match the signing secret in step 2
   export SENTRY_DSN=...
   export SEVERITY_THRESHOLD=high   # optional: low | medium | high | critical
   # Optional: resolve the matching Sentry issue on fix.applied
   export SENTRY_AUTH_TOKEN=...     # event:admin + project:read
   export SENTRY_ORG_SLUG=acme
   export SENTRY_PROJECT_SLUG=web
   npx -p @mushi-mushi/plugin-sentry mushi-plugin-sentry
   ```

2. In the console: **Marketplace → Sentry Mirror → Install**. Set the
   webhook URL to `https://<your-host>/mushi/webhook`, and use the form's
   signing secret (Mushi generates one) as `MUSHI_PLUGIN_SECRET`.

## Package

[`@mushi-mushi/plugin-sentry`](https://www.npmjs.com/package/@mushi-mushi/plugin-sentry)

## Events

| Event | Action |
| --- | --- |
| `report.classified` (severity ≥ threshold, default `high`) | Capture a Sentry event fingerprinted `['mushi', projectId, reportId]`. The plugin can attach the report as Sentry User Feedback instead when the event carries `report.sentry_event_id` and an auth token is set, but Mushi Mushi does not put `sentry_event_id` in the event today |
| `fix.proposed` | Capture an `info` event, only with `MARK_IN_PROGRESS=true` |
| `fix.applied` | Capture an `info` event tagged `mushi.fixed=true`; with an auth token, resolve the matching Sentry issue. The PR link is attached as the `mushi.pr_url` tag |
