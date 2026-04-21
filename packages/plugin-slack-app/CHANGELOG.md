# @mushi-mushi/plugin-slack-app

## 0.2.0

### Minor Changes

- 81336e9: Wave G3 — plugin marketplace deepens from webhooks to first-class apps.
  - `@mushi-mushi/plugin-sdk`: runtime Zod-like event envelope validation (`event-schema`) and a `mushi-plugin` dev CLI with `simulate | sign | verify` for local plugin development.
  - `@mushi-mushi/plugin-jira` (new): Atlassian OAuth 2.0 (3LO) + PKCE install flow, `JiraClient` for create / transition / comment, bidirectional handler that maps Mushi events (`report.created`, `status.changed`, `fix.applied`) to Jira issue lifecycle.
  - `@mushi-mushi/plugin-slack-app` (new): Slack App manifest, request-signature verification, OAuth v2 install, `/mushi` slash command router (replaces the legacy incoming-webhook-only plugin).

### Patch Changes

- Updated dependencies [81336e9]
  - @mushi-mushi/plugin-sdk@0.3.0
