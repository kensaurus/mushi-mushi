---
'mushi-mushi': patch
---

Rewrite the `mushi-mushi` npm README so the package page tells a story in the first scroll instead of dropping visitors into wizard mechanics. Inspired by `vite`, `prisma`, and `@trpc/server` on npmjs.com:

- **Hero image up top.** `docs/screenshots/report-detail-dark.png` is now embedded (via absolute `raw.githubusercontent.com` URL so npmjs.com renders it), linking to the live admin demo.
- **15-word tagline.** "Ship a shake-to-report button. Get AI-classified, deduped, ready-to-fix bug reports." Frameworks listed directly under.
- **"What you get"** — 6 benefit bullets with emoji, each tied to a capability, not a wizard step.
- **"Who it's for"** — 4 personas (solo dev, PM/designer, AI-native team, enterprise) so visitors self-identify in 10 seconds.
- **"Mushi vs your existing stack"** — 9-row comparison table showing what Sentry/Datadog miss. Makes the companion-not-replacement positioning concrete.
- **"Integrates with"** — 10-cell grid covering GitHub, Sentry, Slack, Jira, Linear, PagerDuty, Langfuse, Cursor, Claude Code, Zapier. Plus a line for Datadog/New Relic/Honeycomb/Grafana via `@mushi-mushi/adapters`.
- **Pipeline diagram** — ASCII flow showing widget → fast-filter → deep classify → dedup → judge → dispatch-fix. Points at the root README for the full architecture.
- **Flags, troubleshooting, security** — collapsed into `<details>` so they stop occupying the hero viewport but stay searchable.

Also updates `package.json` `description` from wizard-mechanics ("launcher auto-detects your framework…") to use-case-first ("Ship a shake-to-report button and get AI-classified, deduped, ready-to-fix bug reports…"), with every integration named so the npm search index picks up on them.

No behaviour changes to the launcher binary.
