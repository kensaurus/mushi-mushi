# Screenshots — full admin tour

This is the long-form companion to the README. The README now leads with one
animated tour and one static report screenshot; the grid below shows every
admin surface, kept here so the README stays readable in 90 seconds and the
detail is still one click away for anyone evaluating the project.

Click any image to open the same page in the live admin demo.

<div align="center">

<a href="https://kensaur.us/mushi-mushi/admin/" title="Open the live admin demo — animated guided tour">
  <img src="./screenshots/tour-pdca-loop.gif" alt="Animated guided tour through the logged-in admin console, walking the full Plan → Do → Check → Act loop." width="100%" />
</a>

<sub>↑ animated 4-stop walk through the Plan → Do → Check → Act loop</sub>

<a href="https://kensaur.us/mushi-mushi/admin/" title="Open the live admin demo">
  <img src="./screenshots/report-detail-dark.png" alt="A real classified user-felt bug inside Mushi Mushi — 4-stamp PDCA receipt strip, live Branch & PR timeline, Langfuse trace deeplink." width="100%" />
</a>

<sub>↑ a real bug, end-to-end · the admin is dark-only by design</sub>

</div>

## Tour

A walk through the rooms inside. Click any panel to land on it in the live demo.

<table width="100%">
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/"><img src="./screenshots/quickstart-dark.png" alt="Quickstart mode dashboard — three-page sidebar (Setup, Bugs to fix, Fixes ready) with verb-led labels and zero PDCA jargon." /></a>
    <p align="center"><b>Quickstart mode</b> · <sub>3 pages, verb-led labels, no PDCA jargon. The default for first-time visitors — pill-toggle up to Beginner (9 pages) or Advanced (all pages) anytime.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/"><img src="./screenshots/first-run-tour-dark.png" alt="First-run interactive tour — spotlight cutout around the Plan tile, dark backdrop, coach-mark panel with Next button." /></a>
    <p align="center"><b>First-run tour</b> · <sub>5-stop spotlight tour, no <code>react-joyride</code> dep so it inherits dark theme tokens. Stops that need real data silently skip until the first report lands.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/onboarding"><img src="./screenshots/onboarding-dark.png" alt="Plug-n-play onboarding wizard with PDCA storyboard." /></a>
    <p align="center"><b>Plug-n-play onboarding</b> · <sub>opens with a Plan→Do→Check→Act storyboard so you see the loop before the checklist. Required steps drive the green progress bar; optional steps stay tagged.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/judge"><img src="./screenshots/judge-runresult-dark.png" alt="Judge scores page right after clicking 'Run judge now' — sticky ResultChip beside the button reads 'Dispatched 3 projects'." /></a>
    <p align="center"><b>Sticky run receipts</b> · <sub>every Run / Generate / Dispatch button leaves a persistent <code>ResultChip</code> next to it, so you never have to wonder "did it actually work?" after the toast fades.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/"><img src="./screenshots/dashboard-dark.png" alt="Advanced-mode dashboard with PDCA cockpit — 24-page sidebar grouped by Plan / Do / Check / Act, Next-Best-Action strip, four PDCA tiles on a React Flow canvas with the Do node marked CURRENT FOCUS." /></a>
    <p align="center"><b>Dashboard (Advanced)</b> · <sub>one living number per stage, bottleneck ring, Next-Best-Action strip, 14d severity-stacked histogram, LLM tokens & calls sparklines.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/reports"><img src="./screenshots/reports-dark.png" alt="Triage queue — 4 px severity stripe per row, 14d KPI strip, filter row, 60 real reports with status pills, severity pills, and 'Dispatch fix →' primary action per row." /></a>
    <p align="center"><b>Reports</b> · <sub>triage queue with 4 px severity stripe, 14d severity KPIs with sparklines, blast-radius dedup, Save view preset, single primary action per row.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/fixes"><img src="./screenshots/fixes-dark.png" alt="Auto-fix pipeline — KPI cards with sparklines, '9 PRs are ready for review' banner, per-attempt PDCA cards." /></a>
    <p align="center"><b>Fixes</b> · <sub>per-attempt PDCA cards, 30d KPI sparklines, Langfuse trace per run, real PR links, retry-failed CTA.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/judge"><img src="./screenshots/judge-dark.png" alt="Judge scores with Decide/Act/Verify hero, 12-week score trend with per-dimension lines, score distribution histogram, prompt leaderboard." /></a>
    <p align="center"><b>Judge</b> · <sub>Decide/Act/Verify hero over the charts. Live KPIs, 12w score trend, distribution histogram, prompt leaderboard, one-click re-run.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/repo"><img src="./screenshots/repo-dark.png" alt="Repo graph page — KPI row, filter tabs, per-branch cards, live REPO ACTIVITY stream on the right." /></a>
    <p align="center"><b>Repo</b> · <sub>one branch per auto-fix attempt, grouped by CI status. Live event stream via Supabase Realtime on <code>fix_events</code>.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/intelligence"><img src="./screenshots/intelligence-dark.png" alt="Bug intelligence page with Decide/Act/Verify hero, weekly digest card, recent generation jobs table." /></a>
    <p align="center"><b>Intelligence</b> · <sub>the 3-tile hero pattern in action — Decide surfaces the one-liner that matters, Act collapses to "All clear" when there's nothing to do, Verify deeplinks to the evidence.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/health"><img src="./screenshots/health-dark.png" alt="LLM health with Decide/Act/Verify hero, 24h KPI row, per-function and per-model breakdown, provider probes." /></a>
    <p align="center"><b>Health</b> · <sub>real <code>cost_usd</code> per call, per-function / per-model breakdown, p50/p95 latency, fallback rate, cron triggers, Langfuse deeplinks.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/prompt-lab"><img src="./screenshots/prompt-lab-dark.png" alt="Prompt Lab — KPIs, Stage 1 fast-filter and Stage 2 classify version tables, two pending fine-tuning jobs." /></a>
    <p align="center"><b>Prompt Lab</b> · <sub>A/B traffic split between active and candidate prompts per stage, eval dataset preview, synthetic report generator, fine-tuning jobs queue.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/graph"><img src="./screenshots/graph-dark.png" alt="Knowledge graph in Sankey storyboard mode — two columns labelled COMPONENT and PAGE with bezier links." /></a>
    <p align="center"><b>Knowledge graph</b> · <sub>auto-switches to Sankey storyboard under 12 nodes; full React Flow canvas above. Apache AGE backed when installed, falls back to plain SQL adjacency otherwise.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/compliance"><img src="./screenshots/compliance-dark.png" alt="Compliance dashboard — Latest control evidence table with PASS / WARN pills, Data residency table." /></a>
    <p align="center"><b>Compliance</b> · <sub>SOC 2 control evidence pack with PASS / WARN pills and inline JSON, region pinning per project, print-styled Export PDF, DSAR workflow tracking.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/marketplace"><img src="./screenshots/marketplace-dark.png" alt="Plugin marketplace — Available plugins, Installed section, Recent deliveries." /></a>
    <p align="center"><b>Marketplace</b> · <sub>toggleable extension layer for the loop. Each plugin declares the events it subscribes to and ships with HMAC-signed webhooks.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/inbox"><img src="./screenshots/inbox-dark.png" alt="Action inbox grouped by PDCA stage — KPI strip, sections per stage with one CTA per group." /></a>
    <p align="center"><b>Action inbox</b> · <sub>open actions across the PDCA loop, grouped by stage with one CTA per group. Empty groups skip — the page only renders what's actually waiting on you.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/anti-gaming"><img src="./screenshots/anti-gaming-dark.png" alt="Anti-gaming dashboard — Decide/Act/Verify hero, KPI strip, Flagged devices table." /></a>
    <p align="center"><b>Anti-gaming</b> · <sub>per-device fingerprint tracker that throttles bad-faith reporters and surfaces multi-account abuse. Every enforcement action lands in the audit trail.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/queue"><img src="./screenshots/queue-dark.png" alt="Processing queue (DLQ) — Decide/Act/Verify hero, KPI cards, 14d daily throughput histogram, per-stage backlog bar." /></a>
    <p align="center"><b>Processing queue (DLQ)</b> · <sub><code>worker_jobs</code> viewer with 14d throughput histogram, per-stage backlog bar, and per-job <code>Retry</code> action.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/query"><img src="./screenshots/query-dark.png" alt="Ask Your Data — natural-language SQL, quick-prompt chips, SQL HINTS panel, Saved queries + History sidebar." /></a>
    <p align="center"><b>Ask Your Data</b> · <sub>ad-hoc natural-language SQL over the bug data — read-only Postgres, pre-canned chip prompts, Saved queries + History sidebar.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/research"><img src="./screenshots/research-dark.png" alt="Research notes page — long-form notes from QA and product research, search section with chip topics." /></a>
    <p align="center"><b>Research</b> · <sub>pin QA + product findings here so the next loop iteration starts smarter.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/mcp"><img src="./screenshots/mcp-dark.png" alt="MCP — Model Context Protocol page, 60-second 3-step bootstrap card, Install snippet card." /></a>
    <p align="center"><b>MCP — Model Context Protocol</b> · <sub>per-project <code>.cursor/mcp.json</code> snippet pre-filled with the active <code>MUSHI_PROJECT_ID</code>, 13-tool catalog, 60s 3-step agent bootstrap.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/integrations"><img src="./screenshots/integrations-dark.png" alt="Integrations page — Sentry / Langfuse / GitHub health-checked probes, Codebase indexing card, ROUTING DESTINATIONS." /></a>
    <p align="center"><b>Integrations</b> · <sub><code>Sentry / Langfuse / GitHub</code> health-checked probes with last-probe latency + HTTP code + sparkline, codebase indexing status, routing-destination CRUD.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/notifications"><img src="./screenshots/notifications-dark.png" alt="Reporter Notifications page — outbound messages sent to bug reporters, table with timestamp, type, and per-row actions." /></a>
    <p align="center"><b>Reporter notifications</b> · <sub>outbound messages sent to the people who reported each bug. <code>Show payload</code> reveals the exact JSON the SDK delivered.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/settings"><img src="./screenshots/settings-dark.png" alt="Settings page — 5-tab nav, NOTIFICATIONS card, SENTRY INTEGRATION card, LLM PIPELINE card, DEDUPLICATION card." /></a>
    <p align="center"><b>Workspace settings</b> · <sub>5 tabs covering Slack webhook, Sentry DSN, Stage-2 model picker, Stage-1 confidence threshold, dedup similarity threshold.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/sso"><img src="./screenshots/sso-dark.png" alt="SSO Configuration page — SAML 2.0 + OIDC form, ADD IDENTITY PROVIDER card." /></a>
    <p align="center"><b>SSO config</b> · <sub>SAML 2.0 + OIDC form, calls the Supabase Auth Admin API on submit, surfaces the resulting ACS URL + Entity ID for IdP setup. JIT provisioning on first login is the default.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/audit"><img src="./screenshots/audit-dark.png" alt="Audit Log page — Decide/Act/Verify hero, filter row, table with Time / Action / Actor / Resource columns." /></a>
    <p align="center"><b>Audit log</b> · <sub>append-only history of every mutation, filterable by actor / action / resource / time. <code>Export CSV</code> for the next SOC 2 review.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/storage"><img src="./screenshots/storage-dark.png" alt="Storage page — Decide/Act/Verify hero, PER-PROJECT USAGE table, per-project bucket form." /></a>
    <p align="center"><b>BYO storage</b> · <sub>per-project bucket form (Supabase / S3 / R2), region pinning, presigned-URL TTL editor, vault-ref'd access keys (never plaintext).</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/projects"><img src="./screenshots/projects-dark.png" alt="Projects page — 3 per-project cards with Active pill, slug, last report timestamp, key/report/member counts." /></a>
    <p align="center"><b>Multi-project workspace</b> · <sub>per-project cards with active-key count, reports count, member count, plus inline CTAs to mint a fresh key, send a test report, or open project-scoped Integrations / Settings.</sub></p>
  </td>
</tr>
<tr>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/billing"><img src="./screenshots/billing-dark.png" alt="Billing page — Plans at a glance card with 4-column comparison table." /></a>
    <p align="center"><b>Billing</b> · <sub>plan comparison (Hobby Free / Starter $19 / Pro $99 / Enterprise), per-plan reports/month + overage cents/report + retention days + admin seats, Stripe-metered LLM $ per day, in-app support form.</sub></p>
  </td>
  <td width="50%" valign="top">
    <a href="https://kensaur.us/mushi-mushi/admin/"><img src="./screenshots/report-detail-dark.png" alt="Report detail page for a High-severity login-button bug — 4-stamp PDCA receipt, live Branch & PR timeline." /></a>
    <p align="center"><b>Report detail</b> · <sub>4-stamp PDCA receipt + live Branch & PR timeline — every step of the dispatch lifecycle in a single round-trip so it never N+1s.</sub></p>
  </td>
</tr>
</table>
