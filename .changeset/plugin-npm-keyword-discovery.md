---
"@mushi-mushi/plugin-bugsnag": patch
"@mushi-mushi/plugin-rollbar": patch
"@mushi-mushi/plugin-discord": patch
"@mushi-mushi/plugin-github-issues": patch
"@mushi-mushi/plugin-crashlytics": patch
"@mushi-mushi/plugin-msteams": patch
"@mushi-mushi/plugin-slack-app": patch
"@mushi-mushi/plugin-jira": patch
"@mushi-mushi/mcp-ci": patch
"@mushi-mushi/inventory-auth-runner": patch
"@mushi-mushi/inventory-schema": patch
"eslint-plugin-mushi-mushi": patch
---

Broaden npm keywords on the packages that had the thinnest discovery surface.

The flagship packages carry 18–32 keywords; these twelve carried 4–9, which is
what npm ranks package search on. Each now also carries the tail the
well-indexed plugins already use (`bug-reporting`, `integration`) plus the
category terms a reader would actually search for — `error-monitoring` and
`crash-reporting` on the crash plugins, `chatops` and `alerting` on the chat
plugins, `issue-tracker` and `issue-sync` on the tracker plugins.

Metadata only; no runtime change. Keywords reach npm only on publish, so this
needs a release to take effect.
