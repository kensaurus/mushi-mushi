<div align="center">

# Mushi Mushi

> **Your AI wrote it. Mushi tells you why it broke.**

A user says your app is broken. Mushi Mushi tells you why in plain English and hands the fix to Cursor, Claude Code or Lovable. No Sentry or monitoring needed.

```bash
npx mushi-mushi
```

**[See a sample diagnosis →](https://kensaur.us/mushi-mushi/docs/demo/diagnosis)** No signup, nothing to install.

<sub>`mushi-mushi` is the setup command. It adds the Mushi Mushi SDK to the app you already have: React, Next.js, Vue, Nuxt, Svelte, SvelteKit, Angular, React Native, Expo, Capacitor, Node or plain JavaScript. [Launcher docs](https://kensaur.us/mushi-mushi/docs/sdks/launcher)</sub>

[![npm](https://img.shields.io/npm/v/mushi-mushi?color=cb3837&label=mushi-mushi)](https://www.npmjs.com/package/mushi-mushi)
[![npm downloads](https://img.shields.io/npm/dm/mushi-mushi?color=cb3837&label=downloads)](https://www.npmjs.com/package/mushi-mushi)
[![License](https://img.shields.io/npm/l/mushi-mushi?color=blue)](https://github.com/kensaurus/mushi-mushi/blob/master/LICENSE)
[![Provenance](https://img.shields.io/badge/npm-provenance-8957e5?logo=npm)](https://docs.npmjs.com/generating-provenance-statements)
[![Socket](https://socket.dev/api/badge/npm/package/mushi-mushi)](https://socket.dev/npm/package/mushi-mushi)
[![Node](https://img.shields.io/node/v/mushi-mushi?color=339933&logo=node.js)](https://nodejs.org)

<a href="https://kensaur.us/mushi-mushi/docs/demo/diagnosis" title="See a sample diagnosis: no signup">
  <img src="https://raw.githubusercontent.com/kensaurus/mushi-mushi/master/docs/screenshots/report-detail-dark.png" alt="The Mushi console's report list: each user report with a plain-English summary, how serious it is and how sure Mushi is." width="860" />
</a>

<sub>↑ reports in the Mushi console, each with a plain-English summary. Click for one full sample diagnosis you can read without signing up.</sub>

</div>

---

## What it does

Something in your app feels broken to a user: a button that doesn't react, a page that takes forever, a layout that folds on their phone. Often nothing crashed, so an error tracker stays quiet, and most people just leave.

Mushi Mushi adds a small report button to your app (or shake-to-report on a phone). The user taps it and writes a note. Mushi Mushi saves a screenshot, the page, what they tapped, and the last console and network events. An AI explains the likely cause in plain English and groups repeat reports, so you see one row per real bug. Your editor gets a ready fix prompt. If you want, an agent opens a draft pull request, and you decide whether it merges.

Who it's for and where each group starts: [who it's for](https://kensaur.us/mushi-mushi/docs/who-its-for).

---

## Install in one line

```bash
npx mushi-mushi
```

The wizard signs you in through your browser, detects your framework, installs the right SDK, writes env vars to `.env.local` (with the right prefix for your framework, such as `NEXT_PUBLIC_`, `NUXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_`, `REACT_APP_` or `PUBLIC_`, or bare `MUSHI_*` names for servers and bare React Native), prints the snippet to paste into your app, and offers to send a test report. It never overwrites an existing env var and never edits your source.

```tsx
// After the wizard runs (React + Vite example, src/main.tsx):
import { MushiProvider } from '@mushi-mushi/react'

createRoot(document.getElementById('root')!).render(
  <MushiProvider config={{
    projectId: import.meta.env.VITE_MUSHI_PROJECT_ID,
    apiKey: import.meta.env.VITE_MUSHI_API_KEY,
  }}>
    <App />
  </MushiProvider>
)
```

Building in Lovable or Bolt, with no terminal? Paste one script tag through your prompt instead: [Mushi Mushi in Lovable or Bolt](https://kensaur.us/mushi-mushi/docs/quickstart/lovable-bolt).

Your users now have a report button. Reports land in [the console](https://kensaur.us/mushi-mushi/admin), each with a plain-English diagnosis. The free plan covers one app and 100 diagnoses a month, with no card and no AI key of your own ([pricing](https://kensaur.us/mushi-mushi/docs/pricing)).

Then connect your editor so it can read diagnoses, and ask it: *"Get the latest Mushi report and fix it."*

```bash
npx mushi-mushi setup --ide cursor   # or: claude, continue, zed
```

For Cursor and Claude Code this writes the hosted server entry: the editor opens a browser sign-in on first use and no key is stored on disk. There is also a one-click button on the [connect page](https://kensaur.us/mushi-mushi/docs/connect).

---

## What you get

- **A report button.** It renders in a Shadow DOM, so its CSS and yours never mix. Each report carries a screenshot the user can mark up or remove, the page, recent clicks, and the last console and network events. Reports wait offline and send when the connection is back.
- **A diagnosis for each report.** A fast filter drops spam first. Then a second AI pass names the likely cause, how serious it is, how sure it is, and the part of the app involved, in plain English.
- **One row per real bug.** Reports that mean the same thing are merged, even when users word them differently.
- **The fix in your editor.** Over MCP, Cursor or Claude Code reads the diagnosis and a fix prompt with the smallest set of files. Your editor's own model writes the fix, so this part needs no extra AI key.
- **Optional agent fixes.** An agent can open a draft pull request for you to review. On hosted Mushi Mushi the built-in fixer needs no key of your own; Cursor's agents need your Cursor key; or run fixes on your computer with the Mushi Mushi worker. With your own Anthropic key, a second AI reviews each one before it can merge.

---

## Who it's for

- **You build apps with AI, mostly on your own.** You use Lovable, Bolt, Cursor or Claude Code, and you didn't write most of the code by hand. A user's "it's broken" becomes a plain-English cause and a fix prompt.
- **You're a developer and you own your code.** You read the diffs and may run Sentry already. Reports and Sentry errors share one list, and agent pull requests get a second review before they merge.
- **You run a team.** Reports come from the app, Sentry, store reviews and Slack. They share one list, each with a diagnosis, and can go on to Linear, Jira or GitHub Issues.

Each group's pains and where to start: [who it's for](https://kensaur.us/mushi-mushi/docs/who-its-for).

---

## What else it does

Most bugs never get reported, so Mushi Mushi can also look for them and check the fixes. Each of these is off until you switch it on, and several need your own key:

- A first-time user test: an AI that has never seen your app tries one goal and files where it got stuck (needs the Mushi Mushi worker on your computer).
- A second AI reviews every agent fix before it merges (needs your own Anthropic key).
- A watch on your live site every hour, and an audit of every page once a week (need your own Firecrawl key).
- A daily check of your lockfiles for known security holes (needs your GitHub repo connected).
- Your GitHub Actions bill explained, and whether a red check was your code or the CI machine (needs your GitHub repo; reading the bill needs a token that can see billing).
- Playbooks such as "make it accessible" that run in rounds of fix pull requests (need your own Cursor key or the worker).
- Low-star App Store and Google Play reviews turned into bug reports.
- Bug reports from your phone through Telegram, Slack or an iPhone shortcut.

What each one solves and needs: [what else it does](https://kensaur.us/mushi-mushi/docs/what-it-does).

---

## Why not just Sentry?

> **Sentry is built around what the code threw, with a User Feedback widget and
> replay alongside. Mushi starts from what the user reported, ingests Sentry's
> errors too, explains each one in plain English, and hands your agent a fix
> prompt to start from. One queue, with or without Sentry.**

Mushi Mushi catches the bugs that never throw: a button that looks clickable but isn't, a 12-second page load, a layout broken on one phone. It works without Sentry. If you run Sentry, point its alert webhook at Mushi Mushi and the errors land in the same list; merging a Mushi fix resolves the Sentry issue. Details: [Sentry vs Mushi](https://kensaur.us/mushi-mushi/docs/compare/sentry-vs-mushi).

---

## Integrates with

Nothing needs to be ripped out. Bugs come in from the tools you already run, and fixes and status go back out to them.

**13 outbound plugins** send reports and status to: Slack, Discord, Microsoft Teams, Linear, Jira, GitHub Issues, PagerDuty, Sentry, Bugsnag, Rollbar, Crashlytics, Zapier and Cursor Cloud agents.

**11 inbound adapters** bring alerts from your monitoring into the same list as user reports: Sentry, Datadog, Bugsnag, Rollbar, Firebase Crashlytics, New Relic, Honeycomb, Grafana Loki, AWS CloudWatch, Opsgenie and Firebase Analytics. They ship in [`@mushi-mushi/adapters`](https://www.npmjs.com/package/@mushi-mushi/adapters) for any Node webhook server.

Editors connect over MCP: Cursor, Claude Code, VS Code, Windsurf, Cline, Claude Desktop, Zed and any other MCP client ([`@mushi-mushi/mcp`](https://www.npmjs.com/package/@mushi-mushi/mcp)).

---

## Framework support

| Framework                       | Install after wizard (automatic)                  |
| ------------------------------- | ------------------------------------------------- |
| React, Next.js, Create React App, Remix | `@mushi-mushi/react`                  |
| Vue 3 / Nuxt                    | `@mushi-mushi/vue`                                |
| Svelte / SvelteKit              | `@mushi-mushi/svelte`                             |
| Angular 17+                     | `@mushi-mushi/angular`                            |
| React Native / Expo             | `@mushi-mushi/react-native`                       |
| Capacitor / Ionic               | `@mushi-mushi/capacitor`                          |
| Astro, Solid, plain JavaScript  | `@mushi-mushi/web`                                |
| Node (Express / Fastify / Hono) | `@mushi-mushi/node` (server-side errors)          |
| Flutter / Dart                  | Git dependency, a preview, not on pub.dev yet ([how](https://github.com/kensaurus/mushi-mushi/tree/master/packages/flutter#install)) |
| iOS native (Swift)              | SwiftPM from the repo, a preview, not tagged yet ([how](https://github.com/kensaurus/mushi-mushi/tree/master/packages/ios#install)) |
| Android native (Kotlin/Java)    | Build from source, a preview, not on Maven Central yet ([how](https://github.com/kensaurus/mushi-mushi/tree/master/packages/android#install)) |

The Vue, Svelte and Angular packages bring `@mushi-mushi/web` with them. Prefer to skip the wizard? `npm i @mushi-mushi/react` (or your framework's package) and wire it up by hand.

---

## How the pipeline works

```
User taps the report button ──▶ screenshot + page + clicks + console + network
        │
        ▼
  Fast filter  ──▶  drops spam and empty reports
        │
        ▼
  Diagnosis  ──▶  likely cause, how serious, which part of the app, in plain English
        │
        ▼
  Merge repeats  ──▶  reports that mean the same thing become one row
        │
        ▼
  Your editor (MCP)  ──▶  reads the diagnosis and the fix prompt
        │
        ▼
  Optional agent  ──▶  opens a draft pull request; a second AI reviews it; you merge
```

The full picture: [how it works](https://github.com/kensaurus/mushi-mushi#how-it-works) and [the architecture](https://kensaur.us/mushi-mushi/docs/concepts/architecture).

---

## Other ways to run the wizard

```bash
npx mushi-mushi            # this package
npm create mushi-mushi     # the same wizard
npx @mushi-mushi/cli init  # the same wizard, from the full CLI
```

<details>
<summary><b>Flags for CI, monorepos, and self-hosted</b></summary>

```bash
npx mushi-mushi --framework next               # skip framework detection
npx mushi-mushi --project-id <project-uuid> --api-key mushi_xxx
npx mushi-mushi --skip-install                 # print the install command, don't run it
npx mushi-mushi --skip-test-report             # don't offer to send a test report
npx mushi-mushi --audit                        # health-check an existing install instead
npx mushi-mushi --cwd apps/web                 # run inside a monorepo sub-package
npx mushi-mushi --endpoint https://mushi.your-company.com   # self-hosted
npx mushi-mushi -y                             # take the defaults (needed in CI and AI-agent shells)
npx mushi-mushi -v                             # print version
npx mushi-mushi --help
```

</details>

<details>
<summary><b>Troubleshooting</b></summary>

- **Wrong framework detected?** Pass `--framework <id>`. Valid values: `next, react, cra, remix, astro, solid, vue, nuxt, svelte, sveltekit, angular, expo, react-native, capacitor, express, fastify, hono, vanilla`.
- **Monorepo?** `cd` into the package first, or pass `--cwd apps/web`.
- **Stale `npx` cache?** `npm cache clean --force` or `npx mushi-mushi@latest`.
- **Non-interactive terminal (CI)?** Pass `--yes --project-id <project-uuid> --api-key mushi_xxx`. The wizard exits with a clear error instead of hanging.
- **Node version too old?** Requires Node 20.19 or newer. Upgrade at [nodejs.org](https://nodejs.org/).
- **Full stack traces on error?** `DEBUG=mushi npx mushi-mushi`.

</details>

<details>
<summary><b>Security notes</b></summary>

- Credentials passed via `--api-key` are visible to other users on the same machine via `ps -ef`. Use the interactive prompt on shared hosts.
- `~/.config/mushi/config.json` (the credentials cache) is written with mode `0o600` on Unix; legacy `~/.mushirc` auto-migrates on first load.
- The wizard strips CR/LF/NUL from pasted secrets to prevent `.env` injection.
- Prompts validate format: the project ID is a UUID (or `proj_` + 10 or more characters), and the API key starts with `mushi_` or `mush_pk_` followed by 10 or more characters.
- This release ships with [npm provenance](https://docs.npmjs.com/generating-provenance-statements). Verify it with `npm audit signatures`.

</details>

<details>
<summary><b>Supply-chain & verification (Socket, Bundlephobia, Snyk)</b></summary>

`mushi-mushi` is a CLI launcher. It spawns one `npm install` and appends a small multi-line `MUSHI_*` env block to `.env.local` (or `.env` when `.env.local` does not exist). Here's what each scanner shows and why:

| Scanner            | What it shows                                 | What it actually means                                                                                                                                                                                                           |
| ------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **npm provenance** | Signed by `kensaurus/mushi-mushi @ master`   | Cryptographic Sigstore attestation — `npm audit signatures` will verify this build came from this exact commit on this exact CI workflow.                                                                                        |
| **Socket.dev**     | Score + a few low-signal alerts               | Alerts are expected and benign: `child_process` (used to invoke `npm install` and to forward other commands to `@mushi-mushi/cli`), `process.env` (read `DEBUG`, `npm_config_*`), URL strings (printed in help text). The launcher is `src/index.ts`, about 120 lines; the wizard it runs is `src/init.ts` in `@mushi-mushi/cli`. |
| **Bundlephobia**   | EntryPointError                               | **Expected.** This is a CLI (`bin` only — no `main`/`module`/`exports`), so there is no importable bundle to measure. Bundlephobia only works for libraries you `import`.                                                        |
| **Snyk Advisor**   | Health score (lower right after publish)      | Snyk's crawler often lags by 1–2 weeks for new public packages — score corrects itself once it picks up the actual `package.json` (repository links, downloads, repo activity).                                                  |

If something looks off to you, [open an issue](https://github.com/kensaurus/mushi-mushi/issues). The source is 100% public and the CI build is reproducible.

</details>

---

## Power-user CLI

`mushi-mushi` runs the setup wizard and forwards any other command to `@mushi-mushi/cli` (`npx mushi-mushi reports list` works). For daily use, install the full CLI to get a `mushi` command:

```bash
npm i -g @mushi-mushi/cli
mushi reports list
mushi reports show <id>
mushi reports triage <id> --status triaged --severity high
mushi deploy check          # post-deploy smoke check
mushi doctor                # what is wired up, and the next step when it isn't
```

All commands: [`@mushi-mushi/cli`](https://www.npmjs.com/package/@mushi-mushi/cli).

**Pre-release checks in CI (early).** A GitHub Action runs Mushi Mushi's checks on a pull request, such as API calls that match no endpoint or a status the app claims but never sets. These checks sit behind the `inventory_v2` plan flag. The dead-handler and mock-leak checks also need an ESLint JSON report (`eslint-report`); see the [action's README](https://github.com/kensaurus/mushi-mushi/tree/master/packages/mcp-ci).

```yaml
# .github/workflows/mushi-gates.yml
- uses: kensaurus/mushi-mushi/packages/mcp-ci@master
  with:
    api-key: ${{ secrets.MUSHI_API_KEY }}
    project-id: ${{ secrets.MUSHI_PROJECT_ID }}
    command: gates # also: propose · discover-api · discovery-status · auth-bootstrap
```

Prefer to work from your editor instead of a terminal? `npx mushi-mushi setup --ide cursor` (or `claude`, `continue`, `zed`) connects [`@mushi-mushi/mcp`](https://www.npmjs.com/package/@mushi-mushi/mcp), and the same reads and actions become tools your editor can call. Its README covers a manual config for any other MCP client.

---

## Links

- **[Sample diagnosis](https://kensaur.us/mushi-mushi/docs/demo/diagnosis)**: one bug from report to fix prompt, no signup
- **[Live numbers](https://kensaur.us/mushi-mushi/docs/proof)**: what Mushi Mushi found and fixed on the maker's own apps, with people's reports counted apart from its own checks
- **[GitHub](https://github.com/kensaurus/mushi-mushi)**: source, architecture, self-hosting
- **[Docs](https://kensaur.us/mushi-mushi/docs/)**: quickstarts, concepts, API reference
- **[Report a bug](https://github.com/kensaurus/mushi-mushi/issues)** in Mushi Mushi itself

## License

MIT © [Kenji Sakuramoto](https://github.com/kensaurus). Backend packages (`@mushi-mushi/server`, `agents`, `verify`) are [AGPLv3](https://github.com/kensaurus/mushi-mushi/blob/master/packages/server/LICENSE): if you offer a modified server as a service, publish your changes or get a [commercial license](https://github.com/kensaurus/mushi-mushi/blob/master/COMMERCIAL-LICENSE.md).

## More apps from the same maker

| | App | What it is |
|---|---|---|
| <img src="https://kensaur.us/glot-it/icon-512.png" width="28" height="28" alt=""> | [Glot It](https://kensaur.us/glot-it/?utm_source=github&utm_medium=readme) | Learn Thai — bite-size lessons, smart flashcards, and an AI tutor |
| <img src="https://kensaur.us/yen-yen/icon.svg" width="28" height="28" alt=""> | [yen-yen](https://kensaur.us/yen-yen/?utm_source=github&utm_medium=readme) | Where did the money go? Now you'll know. A kakeibo for households |
| <img src="https://kensaur.us/the-wanting-mind/pwa-512x512.png" width="28" height="28" alt=""> | [The Wanting Mind](https://kensaur.us/the-wanting-mind/?utm_source=github&utm_medium=readme) | How the Battle Between Extraction and Generation Is Reshaping Our World — a 147,000-word interactive webbook with 268 concepts, 242 citations, and original illustrations |
| <img src="https://kensaur.us/help-her-take-photo/assets/apple-touch-icon.png" width="28" height="28" alt=""> | [Help Her Take Photo](https://kensaur.us/help-her-take-photo/?utm_source=github&utm_medium=readme) | Pair phones, direct the pose, nail the photo |
| <img src="https://talk.kensaur.us/pwa-192.png" width="28" height="28" alt=""> | [Cooler Heads](https://talk.kensaur.us/?utm_source=github&utm_medium=readme) | Practice hard conversations before you have them |
| <img src="https://solo-boss.kensaur.us/apple-touch-icon.png" width="28" height="28" alt=""> | [一人社長 Solo Boss](https://solo-boss.kensaur.us/?utm_source=github&utm_medium=readme) | Bookkeeping and tax-filing co-pilot for one-person companies in Japan |
| <img src="https://tsumagoi.kensaur.us/apple-touch-icon.png" width="28" height="28" alt=""> | [Tsumagoi Work&Camp 嬬恋牧場](https://tsumagoi.kensaur.us/?utm_source=github&utm_medium=readme) | Coworking camp at 1,444 m — [Instagram](https://www.instagram.com/tsumagoicamp/) · [Facebook](https://www.facebook.com/profile.php?id=61592113053042) · [Maps](https://maps.app.goo.gl/JCNnTfsdQVHCS1FA7) |
| <img src="https://github.com/kensaurus.png" width="28" height="28" alt=""> | [kenji skills](https://github.com/kensaurus/skills) | Agent skills and slash commands for Claude Code, Cursor, Codex, and Gemini |
| <img src="https://kensaur.us/favicon.svg" width="28" height="28" alt=""> | [kensaur.us](https://kensaur.us/?view=portfolio&utm_source=github&utm_medium=readme) | All apps from the same maker |

All apps live under [kensaur.us](https://kensaur.us).


<!-- mushi-readme-stats-footer -->
---

<sub>Monorepo scale (October 2026): 77 edge functions · 529 SQL migrations · 13 outbound plugins · 11 inbound adapters · 19 pipeline agents. Canonical counts: <a href="https://github.com/kensaurus/mushi-mushi/blob/master/docs/stats.md">docs/stats.md</a> · <code>pnpm docs-stats</code></sub>
