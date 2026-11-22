---
name: mushi-sdk-upgrade
description: "Upgrade the Mushi Mushi SDK in a host app and apply what changed: the mushi-mushi 1.x package, older scoped @mushi-mushi/* installs, renamed options (beforeSend, tunnel, ignoreErrors), and the rule that mushi-mushi 0.x is only the old setup command, not the SDK. Use when Dependabot, mushi upgrade --check, the console or MCP check_sdk_version says the SDK is outdated, when moving from @mushi-mushi/* to mushi-mushi, or when reports are blocked by an ad blocker."
triggers:
  - "mushi sdk upgrade"
  - "upgrade mushi"
  - "update mushi sdk"
  - "mushi outdated"
  - "mushi tunnel"
  - "ignoreErrors mushi"
  - "switch to mushi-mushi package"
license: MIT
---

<!-- GENERATED from skills/mushi-sdk-upgrade/SKILL.md by scripts/sync-skills.mjs. Do not edit this copy: edit the source, then run `pnpm sync:skills`. -->

# Mushi Mushi SDK upgrade

Do not bump the pin and walk away. Find out which packages the app really
uses, read the changelog for that range, bump, then apply the option changes
in the app's own config.

Every `mushi <command>` below also runs as `npx mushi-mushi <command>`, with no
install. `npm install -g @mushi-mushi/cli` gives you the short `mushi`.

## Step 1 — Find what the app installs

```bash
node -e "const p=require('./package.json'); const d={...p.dependencies,...p.devDependencies}; for (const [k,v] of Object.entries(d)) if (k==='mushi-mushi'||k.startsWith('@mushi-mushi/')) console.log(k, v)"
```

Read the result with these rules:

| Found | What it is | What to do |
|-------|------------|------------|
| `mushi-mushi` at 1.x or later | The SDK. One package; the app imports `mushi-mushi` or a subpath (`mushi-mushi/react`, `/vue`, `/svelte`, `/angular`, `/node`) | Bump it |
| `mushi-mushi` at 0.x | **Not the SDK.** Before 1.0 this package was only the `npx mushi-mushi` setup command, kept as a devDependency | Leave it, or remove it. Never bump it to 1.x on its own: that adds the whole SDK to an app that never imports it |
| `@mushi-mushi/web`, `core`, `react`, `vue`, `svelte`, `angular`, `node` | The older scoped install. It keeps working and keeps getting updates | Bump it, or move to `mushi-mushi` (step 4) |
| `@mushi-mushi/react-native`, `@mushi-mushi/capacitor` | Still scoped on purpose: native code must be a top-level dependency | Bump it; do not move it |

Then check the versions:

```bash
mushi upgrade --check     # exit 0 current, 1 outdated, 2 registry unreachable
```

From the editor, `check_sdk_version { package: "mushi-mushi", current: "<installed>" }`
(or a scoped name) compares against the catalog without changing anything.
`mushi upgrade` and `mushi doctor` already skip a 0.x `mushi-mushi`.

## Step 2 — Read the changelog for the range

Read the entries between the installed version and the latest:
`packages/launcher/CHANGELOG.md` for `mushi-mushi`, and
`packages/web/CHANGELOG.md` / `packages/core/CHANGELOG.md` for the SDK itself
(scoped installs too). For a scoped install still on 0.x, follow the
[0.x → 1.x guide](https://kensaur.us/mushi-mushi/docs/migrations/mushi-sdk-upgrade):
the Vue, Svelte and Angular adapters call `Mushi.init()` themselves from 1.0,
so remove the app's own call.

## Step 3 — Bump

```bash
mushi upgrade             # bumps every Mushi Mushi SDK it found, with the app's package manager
```

Or, in the console, **Create Upgrade PR** opens a reviewed GitHub PR with the
same bump.

## Step 4 — Moving from `@mushi-mushi/*` to `mushi-mushi` (optional)

The same code ships in `mushi-mushi`. Install it, change the imports, then
remove the scoped packages:

| Old import | New import |
|------------|------------|
| `@mushi-mushi/web` | `mushi-mushi` (or `mushi-mushi/web`) |
| `@mushi-mushi/react`, `vue`, `svelte`, `angular` | `mushi-mushi/react`, `/vue`, `/svelte`, `/angular` |
| `@mushi-mushi/node` (and `/express`, `/fastify`, `/hono`) | `mushi-mushi/node` (and `/node/express`, `/node/fastify`, `/node/hono`) |
| `@mushi-mushi/core` | `mushi-mushi/core` |

Frameworks are optional peers of `mushi-mushi`, so it never installs one the
app does not use. Do not move React Native or Capacitor.

## Step 5 — Option changes in the app's config

| Old | New | Notes |
|-----|-----|-------|
| `beforeSendFeedback` | `beforeSend` | `beforeSend` covers every report type and wins when both are set |
| `apiEndpoint` pointing straight at `*.supabase.co/functions` | `tunnel: "/api/mushi-tunnel"` | A same-origin proxy that ad blockers do not block (the same idea as Sentry's `tunnel`). The app's server must expose it (step 6) |
| Unfiltered automatic error capture | `ignoreErrors` / `denyUrls` / `allowUrls` | Filters automatic errors only. Reports a user sends from the widget are never dropped by them |
| `replaysOnErrorSampleRate: 1` | Leave it at the default `0` | Session replay at 1.0 sends far more data than reports need |

## Step 6 — Same-origin tunnel (only if reports are ad-blocked)

1. SDK: `tunnel: "/api/mushi-tunnel"`. On an older SDK that ignores
   `tunnel`, also set `apiEndpoint: "/api/mushi-tunnel"`.
2. The app's server: a proxy that forwards only to the Mushi Mushi API host,
   only for its own project id and only `/v1/` paths. With no project id
   configured it answers 503; it must never become an open proxy.
3. Exempt the route from CSRF checks, rate-limit it, and keep every other
   public path denied by default.

## Step 7 — Verify

- `mushi upgrade --check` exits 0.
- `check_sdk_version` returns `outdated: false`.
- `mushi doctor` passes, and a test report arrives (`mushi test`, or submit
  one from the widget). With a tunnel, the browser's network tab shows
  `/api/mushi-tunnel/v1/…`, not `*.supabase.co`.
- A user's widget report still goes through when `ignoreErrors` would drop a
  matching automatic error.

## Do not

- Publish anything to npm from this skill.
- Turn on session replay to make the upgrade look complete.
- Bump a 0.x `mushi-mushi` devDependency to 1.x as if it were the SDK.
