---
name: mushi-sdk-upgrade
description: >-
  Upgrade a host app's @mushi-mushi/* pin and apply the current SDK
  config surface (tunnel, ignoreErrors, beforeSend). Use when Dependabot
  or mushi upgrade --check reports drift, when MCP check_sdk_version
  returns outdated=true, or when ingest is ad-blocked.
triggers:
  - "mushi sdk upgrade"
  - "upgrade mushi"
  - "mushi tunnel"
  - "ignoreErrors mushi"
  - "mushi outdated"
license: MIT
---

# Mushi SDK Upgrade

Do **not** bump the pin and walk away. Detect the installed version, read the
changelog for that range, then apply API + config migrations in the host app.

## Step 1 — Detect the pin

```bash
# Host app
node -e "const p=require('./package.json'); console.log(p.dependencies?.['@mushi-mushi/web']||p.overrides?.['@mushi-mushi/web']||'missing')"

# Or MCP (does not bump the pin)
check_sdk_version({ package: "@mushi-mushi/web", current: "<installed>" })

# CLI
mushi upgrade --check
```

Exit codes for `mushi upgrade --check`: `0` current · `1` outdated · `2` error.

## Step 2 — Changelog

Read `packages/web/CHANGELOG.md` and `packages/core/CHANGELOG.md` (or the
npm release notes) for every version between the pin and latest. Apply the
renames below if the host still uses the old names.

## Step 3 — API migrations (host config)

| Old | New | Notes |
|-----|-----|-------|
| `beforeSendFeedback` | `beforeSend` | Feedback-only hook is ignored when `beforeSend` is set. User widget reports must never be dropped by `ignoreErrors`. |
| direct `apiEndpoint` to `*.supabase.co/functions` | `tunnel: "/api/mushi-tunnel"` **and** `apiEndpoint: "/api/mushi-tunnel"` | Same-origin proxy beats ad blockers (Sentry `tunnel` pattern). Host API must expose an allowlisted proxy. |
| unfiltered auto-capture | `ignoreErrors` / `denyUrls` / `allowUrls` | Auto errors only. Never filter user-submitted widget feedback. |
| `replaysOnErrorSampleRate: 1` | default `0` | Do not turn on rrweb at 1.0 — egress leak. |

## Step 4 — Same-origin tunnel (SBC / Express hosts)

Browser calls stay first-party:

1. SDK: `tunnel: "/api/mushi-tunnel"` (and `apiEndpoint` on published SDKs that ignore `tunnel`)
2. Host API: allowlisted proxy — host + project id + `/v1/` only; empty project list → 503, not an open proxy
3. CSRF skip + default-deny public path + rate limit (mirror `/api/sentry-tunnel`)

## Step 5 — Verify

- `mushi upgrade --check` exits 0 after the pin bump
- `check_sdk_version` returns `outdated: false` (no `suggestedActions`)
- A test report reaches Mushi (network tab shows `/api/mushi-tunnel/v1/…`, not `*.supabase.co`)
- User widget submit still works when `ignoreErrors` would drop a matching auto error

## Do not

- Publish npm from this skill — that is a human gate
- Make freshness CI required on deploy-aws / check:g0
- Add MCP prompts/resources (Sentry removed unused ones Oct 2025)
- Enable session replay to “make upgrade look complete”
