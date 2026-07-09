---
name: mushi-setup
description: >-
  Guided Mushi Mushi onboarding — install the right SDK for the detected
  framework, sign in, write env vars, and wire the MCP server into the editor.
  Use when "set up mushi", "install mushi", "add mushi to this project",
  "mushi onboarding", "wire mushi into cursor/claude", or when a repo has no
  Mushi SDK yet and the user wants bug capture + AI diagnosis.
triggers:
  - "set up mushi"
  - "install mushi"
  - "add mushi to this project"
  - "mushi onboarding"
  - "mushi setup"
  - "wire mushi mcp"
  - "connect mushi to cursor"
  - "connect mushi to claude code"
license: MIT
---

# Mushi Setup

Onboard the current repo onto Mushi Mushi. The CLI wizard already automates
detection, auth, install, and env writing — **delegate to it instead of
hand-editing files**, then verify.

## Step 1 — Run the wizard (SDK install + credentials)

```bash
npx mushi-mushi
```

What it does: detects the framework and package manager, opens a browser
sign-in (device auth — no copy-paste), lets you pick/create a project,
installs the matching `@mushi-mushi/*` SDK, writes framework-prefixed env vars
(e.g. `VITE_MUSHI_PROJECT_ID` / `VITE_MUSHI_API_KEY`, or `NEXT_PUBLIC_MUSHI_*`)
to `.env.local`, and prints the init snippet to paste.

Those two env vars are all the SDK needs — no Supabase, no LLM key
(the repo-root `.env.example` you may see in the mushi-mushi source repo is
for self-hosting the backend, not for SDK users).

Non-interactive / CI fallback:

```bash
mushi login --api-key mushi_... --project-id <uuid>
```

Already installed? Health-check instead of re-running the wizard:

```bash
npx mushi-mushi --audit
```

### Framework → package decision tree

The wizard applies this mapping automatically (`--framework <id>` forces one).
Use it when installing manually or reviewing what the wizard chose:

| If the project has… | Framework | SDK package |
|---------------------|-----------|-------------|
| `next` | Next.js | `@mushi-mushi/react` |
| `react` (no meta-framework) / `react-scripts` / `@remix-run/*` | React / CRA / Remix | `@mushi-mushi/react` |
| `vue` v3 | Vue 3 | `@mushi-mushi/vue` |
| `nuxt` | Nuxt | `@mushi-mushi/vue` |
| `svelte` / `@sveltejs/kit` | Svelte / SvelteKit | `@mushi-mushi/svelte` |
| `@angular/core` | Angular | `@mushi-mushi/angular` |
| `astro` / `solid-js` | Astro / Solid | `@mushi-mushi/web` |
| `expo` / `react-native` | Expo / React Native | `@mushi-mushi/react-native` |
| `@capacitor/core` | Capacitor (Ionic) | `@mushi-mushi/capacitor` |
| none of the above | Vanilla JS | `@mushi-mushi/web` |
| Node server (Express/Fastify/Hono) | Server | `@mushi-mushi/node` |

Coming from Sentry? Don't remove it — see the
[Sentry + Mushi guide](https://kensaur.us/mushi-mushi/docs/migrations/sentry-to-mushi)
(enrich or standalone; `mushi migrate` detects `@sentry/*` and suggests it).

## Step 2 — Paste the init snippet

The wizard prints a framework-specific snippet (e.g. `<MushiProvider>` for
React, `initMushi()` for vanilla). Paste it at the app entry point. If the
snippet was lost, each framework page under
`https://kensaur.us/mushi-mushi/docs/sdks` has it.

## Step 3 — Wire the MCP server into the editor

```bash
npx mushi-mushi setup --ide cursor    # or: claude | continue | zed
```

Multiple projects in one workspace: `mushi setup --all-projects`.

## Step 4 — Verify end-to-end

```bash
mushi doctor --onboarding
```

This prints a single next action if anything is missing (SDK imported but not
initialized, env var absent, MCP entry stale, heartbeat never received…).
Every `FAIL` line comes with a `→ Fix:` hint. For a full sweep use
`mushi doctor --full`.

Then send a test report: trigger any error in the running app (or use the
wizard's "send test report" option) and confirm it appears with
`get_recent_reports` (MCP) or in the console dashboard.

## Handoffs

- Pipeline health after setup → [`mushi-health`](../mushi-health/SKILL.md)
- Ingest/MCP/pipeline failures → [`mushi-debug`](../mushi-debug/SKILL.md)
- Two-way loop, lessons, fix dispatch → [`mushi-integration`](../mushi-integration/SKILL.md)
