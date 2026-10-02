---
"@mushi-mushi/mcp": minor
---

Add three tools, on by default in the `inventory` group. The two portfolio tools need an account-level key; a key bound to one project gets a 403.

- `get_portfolio` returns one card per app in an organization: the worst recipe state, open reports, the latest release, the Mushi SDK against the latest release of the same package, and the hole checks. A check that never ran reads `never_run`, never as healthy.
- `list_portfolio_findings` returns the problems open in two or more apps (one paste-ready fix prompt each), the SDK version of every app, and integrations most of your other apps have but one lacks.
- `get_radar` returns the hole checks: store names that differ between stores, a missing listing language, an expiring domain or certificate, missing security headers, a broken privacy link, storage rows deleted with SQL, and store build rules your app no longer meets. A check that never ran reads `unknown`, never healthy. `scope: "organization"` lists the open findings of every app.

The portfolio tools take an optional `organizationId`; without it, your only organization is used.

Also adds `get_recipe_drift` (what drifted from the recipe — CI workflows, deploys not live, env names, unapplied migrations, off-token values — each with a fix) and `list_connectors` (the sources an organization connected, their status and scopes; never credentials). `list_gate_findings` accepts the `radar`, `radar_ci` and `store_review` gates.

Three write tools, dry run by default: `propose_recipe_change` (one draft PR to paths the recipe allows; it stays a draft), `propose_portfolio_change` (the same fix in up to 10 repos, one draft PR each) and `request_connector_action` (asks for a store action such as a Play rollout change; nothing runs until a person approves and runs it in the console — a key can never approve). The server instructions now list them with the other confirm-first tools.
