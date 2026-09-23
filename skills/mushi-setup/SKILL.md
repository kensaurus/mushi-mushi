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

## Step 0 — Read the current docs, not this file's memory

This skill is a procedure, not a copy of the docs. Package names, env-var
prefixes, and snippets change; before quoting any of them, look them up:

- With the Mushi MCP server connected: call the `search_mushi_docs` tool
  (e.g. `search_mushi_docs { query: "expo quickstart" }`). It returns the
  page URL and a one-line excerpt; open the URL for the snippet.
- Without MCP: fetch `https://kensaur.us/mushi-mushi/docs/llms.txt` (every
  page, one link per line) and open the matching page, or the plain-markdown
  twin at `https://kensaur.us/mushi-mushi/docs/llm-md/<path>.md`.

If what you find disagrees with the tables below, the docs win.

## Step 1 — Run the wizard (SDK install + credentials)

From an agent's terminal (no TTY), always pass `--yes`:

```bash
npx mushi-mushi --yes
```

What it does: detects the framework and package manager, opens a browser
sign-in (device auth — no copy-paste) and waits for approval, picks the
project named after this app (or creates it), installs the matching
`@mushi-mushi/*` SDK, writes framework-prefixed env vars (e.g.
`VITE_MUSHI_PROJECT_ID` / `VITE_MUSHI_API_KEY`, or `NEXT_PUBLIC_MUSHI_*`) to
`.env.local`, and prints the init snippet to paste.

Sign-in needs the user once: the command prints a URL and a code, then waits
up to 10 minutes. If no browser opened on the user's machine, give them that
URL and code and wait — do not kill the command. Run it in the background if
your shell would time out first. If the user already ran
`npx mushi-mushi login`, the wizard reuses that sign-in; the first run still
asks for one approval to mint the app's ingest-only key.

The env key is ingest-only: it can submit reports and cannot read them, which
is why it is safe inside a browser bundle. The CLI's own key (which can read
reports, for MCP) stays in the CLI config and never goes into `.env.local`.
Those two env vars are all the SDK needs — no Supabase, no LLM key (the
repo-root `.env.example` you may see in the mushi-mushi source repo is for
self-hosting the backend, not for SDK users).

Do not paste API keys onto the command line yourself — they land in the
transcript and in `ps`. The only keyed form is for CI with no browser, using
an ingest-only (report:write) key from the console:

```bash
npx mushi-mushi --yes --project-id <uuid> --api-key <ingest-only key>
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
| `react` + `vite` (incl. a **Lovable export**) | Vite + React | `@mushi-mushi/react` |
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

### Path notes (where the wizard needs a hint)

- **Next.js** — env prefix `NEXT_PUBLIC_MUSHI_*`; the provider goes in
  `app/layout.tsx` (App Router) or `pages/_app.tsx`. Static export
  (`output: 'export'`) works; see `search_mushi_docs { query: "next static export" }`.
- **Vite (React)** — env prefix `VITE_MUSHI_*`, read via `import.meta.env`;
  wrap `<App />` in `src/main.tsx`. Restart `vite dev` after writing `.env.local`.
- **Lovable export** — it is a Vite + React + TypeScript app, usually with a
  Supabase client under `src/integrations/supabase/`. Treat it as the Vite
  path above; run the wizard with `--framework react` if detection is unsure.
  Mushi does not need the app's Supabase keys — only its own two env vars —
  and the Supabase client stays untouched. Commit `.env.local` changes only
  to the `.env.example`; the real values go into Lovable's project secrets /
  the host's env settings before redeploying.
- **Expo / React Native** — package `@mushi-mushi/react-native`; env prefix
  `EXPO_PUBLIC_MUSHI_*` (Expo) or your config plugin; wrap the root component
  in `App.tsx` / `app/_layout.tsx`. Rebuild the dev client after install — a
  JS-only reload does not pick up native deps. Bare RN: run `pod install`.

## Step 2 — Paste the init snippet

The wizard prints a framework-specific snippet (e.g. `<MushiProvider>` for
React, `initMushi()` for vanilla). Paste it at the app entry point. If the
snippet was lost, each framework page under
`https://kensaur.us/mushi-mushi/docs/sdks` has it.

## Step 3 — Wire the MCP server into the editor

```bash
npx mushi-mushi setup --ide cursor    # or: claude | continue | zed
```

Cursor gets `.cursor/mcp.json`; Claude Code gets `.mcp.json` at the repo root
(Claude Code asks the user to approve it on first use). Both default to the
hosted server: the user signs in from the editor's MCP panel and no key is
written to the repo, so the file is safe to commit. Preview first with
`--dry-run` — it signs nothing in and writes nothing.

Multiple projects in one workspace: `npx mushi-mushi setup --all-projects`.

## Step 4 — Verify end-to-end

```bash
npx mushi-mushi doctor --onboarding
```

This prints a single next action if anything is missing (SDK imported but not
initialized, env var absent, MCP entry stale, heartbeat never received…).
Every `FAIL` line comes with a `→ Fix:` hint. For a full sweep use
`npx mushi-mushi doctor --full`.

Then send a test report: trigger any error in the running app (or use the
wizard's "send test report" option) and confirm it appears with
`get_recent_reports` (MCP) or in the console dashboard. With MCP connected,
`activation_status` reports the phase (`ingest` → `dispatch` → `loop`) and
`diagnose_setup` explains any remaining gap; `mushi status` prints the same
`Activation:` line from the terminal.

If a check fails and the `→ Fix:` hint is not enough, look it up before
guessing: `search_mushi_docs { query: "<the FAIL line>" }`.

## Handoffs

- Pipeline health after setup → [`mushi-health`](../mushi-health/SKILL.md)
- Ingest/MCP/pipeline failures → [`mushi-debug`](../mushi-debug/SKILL.md)
- Two-way loop, lessons, fix dispatch → [`mushi-integration`](../mushi-integration/SKILL.md)
