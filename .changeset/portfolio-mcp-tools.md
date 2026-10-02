---
"@mushi-mushi/mcp": minor
---

Add three tools, on by default in the `inventory` group. The two portfolio tools need an account-level key; a key bound to one project gets a 403.

- `get_portfolio` returns one card per app in an organization: the worst recipe state, open reports, the latest release, the Mushi SDK against the latest release of the same package, and the hole checks. A check that never ran reads `never_run`, never as healthy.
- `list_portfolio_findings` returns the problems open in two or more apps (one paste-ready fix prompt each), the SDK version of every app, and integrations most of your other apps have but one lacks.
- `get_radar` returns the hole checks: store names that differ between stores, a missing listing language, an expiring domain or certificate, missing security headers, a broken privacy link, storage rows deleted with SQL, and store build rules your app no longer meets. A check that never ran reads `unknown`, never healthy. `scope: "organization"` lists the open findings of every app.

The portfolio tools take an optional `organizationId`; without it, your only organization is used.
