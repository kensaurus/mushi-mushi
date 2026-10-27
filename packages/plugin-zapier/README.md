# `@mushi-mushi/plugin-zapier`

> **Your AI wrote it. Mushi tells you why it broke.**

Sends Mushi bug events to a Zapier "Catch Hook", so you can pass them on to
Notion, Google Sheets, email or any other Zapier app without writing code.

**Do you need this package?** Not to get started: on Mushi Cloud you can
install **Zapier Bridge** from the console's **Marketplace** page and paste
the Catch Hook URL straight in. Run this package between Mushi and Zapier
when you want the signature checked and a flat payload that is easier to map
in Zapier.

```bash
npm i @mushi-mushi/plugin-zapier
export MUSHI_PLUGIN_SECRET=...   # the signing secret you set when installing "Zapier Bridge"
export ZAPIER_HOOK_URL=https://hooks.zapier.com/hooks/catch/.../...
export ALLOW_EVENTS=report.classified,fix.applied   # optional
export DENY_EVENTS=report.status_changed            # optional
npx -p @mushi-mushi/plugin-zapier mushi-plugin-zapier   # POST /mushi/webhook on PORT (default 3000)
```

Then set the Zapier Bridge webhook URL to `https://<your-host>/mushi/webhook`.

Docs: https://kensaur.us/mushi-mushi/docs/plugins/zapier

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


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (July 2026): 77 edge functions · 510 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
