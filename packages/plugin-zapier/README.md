# `@mushi-mushi/plugin-zapier`

Reference Mushi Mushi plugin: forward any Mushi event to a Zapier "Catch
Hook" trigger so non-engineers can wire Mushi into the rest of the org's
automation surface (Notion, Sheets, Mailchimp, Slack channels, etc.).

## Install

```bash
npm i @mushi-mushi/plugin-zapier
```

## Run as a stand-alone server

```bash
ZAPIER_HOOK_URL=https://hooks.zapier.com/hooks/catch/.../...
MUSHI_PLUGIN_SECRET=...
ALLOW_EVENTS=report.classified,sla.breached    # optional
DENY_EVENTS=report.dedup_grouped               # optional
PORT=3000
npx mushi-plugin-zapier
```

The handler subscribes to `*` and forwards a flattened payload that Zapier
can parse without diving into nested objects:

```json
{
  "event": "report.classified",
  "delivery_id": "...",
  "occurred_at": "...",
  "project_id": "...",
  "plugin_slug": "zapier",
  "report_id": "...",
  "report_status": "classified",
  "report_category": "bug",
  "report_severity": "high",
  "report_title": "Login button does nothing",
  "raw": { /* full Mushi envelope */ }
}
```

## License

MIT
