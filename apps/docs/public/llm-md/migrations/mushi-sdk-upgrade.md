# @mushi-mushi/* upgrades

Source: https://kensaur.us/mushi-mushi/docs/migrations/mushi-sdk-upgrade

---
title: '@mushi-mushi/* upgrades'
---

# `@mushi-mushi/*` upgrades

 

  **Most packages are already on 1.x.** `@mushi-mushi/core` and `@mushi-mushi/web`
  are on **1.23.x**; `react` **1.21.x**; `vue` / `svelte` / `angular` / `node` /
  `capacitor` on **1.x**. Mobile tracks remain independent (`react-native`
  **0.20.x**, native iOS/Android **0.4.x**). Use each package&apos;s CHANGELOG
  and `npx mushi-mushi upgrade` for mechanical bumps.

## What stays stable

We expect upgrades within the documented public API to **not** break:

- The `Mushi.init({ projectId, apiKey })` shape — this is the public
  contract every customer wires.
- The `Mushi.report({ description, ... })` shape.
- The `` component in React (and framework equivalents).
- Wire-format API endpoints (`/v1/reports`, `/v1/admin/*`).
- The MCP server protocol.

Possible churn (check CHANGELOG before bumping):

- Internal capture types exported via `@mushi-mushi/core`.
- Legacy `Mushi.captureException` shims.
- Bundled-CSS export paths and default privacy-redaction lists.

If you build only against the documented public API (everything under
`/sdks/*` in these docs), most upgrades are a single bump in
`package.json`.

## Migration checklist

Each package ships its own CHANGELOG.md in the GitHub repo (e.g. @mushi-mushi/web). Skim the latest entry for breaking changes.</> },
    { id: 'pin-current', label: 'Pin your current versions before upgrading', content: <>If you\'re on a range like "@mushi-mushi/react": "^1.x.y", change to the exact pin first so your lockfile is clean.</> },
    { id: 'codemod', label: 'Run the upgrade helper', content: {`npx mushi-mushi upgrade`} },
    { id: 'manual-review', label: 'Review the diff', content: <>Mechanical rewrites are covered; CSP rules and custom widget styling need manual attention.</> },
    { id: 'rebuild', label: 'Rebuild + run your test suite', content: <>Type errors usually surface here. Most are easy one-line fixes.</> },
    { id: 'smoke-test', label: 'Smoke-test on a real device / browser', content: <>Submit a test report. Confirm console + network + screenshot capture still work and the report lands in the admin console.</> },
    { id: 'update-prod', label: 'Roll out to production behind a canary', content: <>Mushi is a passive SDK — it can only fail to capture (best case) or capture wrong things (worst case). Both are easy to roll back.</> },
  ]}
/>

## Current package tracks (workspace snapshot)

| Package | Current track |
|---------|---------------|
| `@mushi-mushi/core` / `web` | 1.23.x |
| `@mushi-mushi/react` | 1.21.x |
| `@mushi-mushi/vue` / `svelte` / `angular` | 1.0.x |
| `@mushi-mushi/node` / `capacitor` | 1.1.x |
| `@mushi-mushi/react-native` | 0.20.x |
| `@mushi-mushi/cli` | 0.26.x |
| `@mushi-mushi/mcp` | 0.19.x |
| iOS / Android native | 0.4.x |

See the [SDK index](/sdks) version matrix for the live workspace snapshot.
