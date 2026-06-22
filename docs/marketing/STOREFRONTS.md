# STOREFRONTS — polish the surfaces visitors land on

Before a single hour on outreach, these pages need to be retail-ready. Every
research source flags them as the #1 leverage point: stars and installs come
from whether the first 10 seconds on each surface *works*.

Tick these off in order. Most are one-time.

> 🤖 The boring transactional bits (GitHub repo chrome, demo seeding, mascot
> set, OG card, README GIF) are now scripted under
> [`scripts/marketing/`](../../scripts/marketing/). Run `node scripts/marketing/setup-github.mjs`
> for the GitHub side, `node scripts/marketing/seed-demo.mjs` for demo content,
> and `node scripts/marketing/record-readme-gif.mjs` for the hero GIF. The
> mascot set and OG card are committed under [`docs/mascot/`](../mascot/) and
> [`docs/social-preview/`](../social-preview/).

## 1. README ([../../README.md](../../README.md))

- [x] **Star CTA at the footer** — added (`もしMushi-chanのお役に立てたら…`).
- [x] **npm keyword arrays** populated across all 12 SDK packages.
- [ ] **Hero GIF above the fold** — 30-second screen-record: user wiggles phone
  → bottom sheet appears → types one sentence → admin shows the report
  classified within seconds → Dispatch fix → PR opens. Loop it. Keep it under
  6 MB so GitHub's player auto-plays. Drop at top of `README.md`, replacing or
  above the current hero screenshot (keep the screenshot as fallback inside
  `<picture>`).
- [ ] **Incident loop GIF (v2 positioning, Jun 2026)** — 20–30s silent loop for
  vibe-coder GTM: AI ships code → prod breaks → Mushi MCP `get_fix_context` +
  `summarize_report_for_fix` in Cursor → paste fix prompt → merged. Script:
  [`apps/docs/content/quickstart/incident-loop.mdx`](../../apps/docs/content/quickstart/incident-loop.mdx).
  Save as `docs/screenshots/incident-loop.gif` (or `.webp`). **One asset, three
  pre-wired slots** — drop the file in and uncomment each:
  1. `README.md` — `TODO(loop-video)` comment above the TL;DR table.
  2. `apps/docs/content/quickstart/incident-loop.mdx` — `TODO(loop-video)` slot
     under the intro (served at `/screenshots/incident-loop.gif` via the docs
     `sync-docs-screenshots` prebuild).
  3. Launch Week / Product Hunt / Show HN thumbnail.
  **Target metric:** time-to-first-diagnosis under ~2 minutes for a fresh
  install. Record only once Workstream C makes the in-editor loop buttery (the
  human screen-capture is the one step an agent can't automate — the Cursor
  session + merge must be filmed live).
- [ ] **Enhance README screenshots with `docs/screenshots/hero-gif.webp`** — use
  `<picture>` with `source srcset="…hero-gif.webp"` + `<img src="…report-detail-dark.png">`
  so the static image still renders in RSS/email clients.
- [ ] **Pin a `good first issue`** — "Submit Mushi to an awesome-* list". See
  [drip-channels.md](./drip-channels.md) for the list.

## 2. npm pages (`@mushi-mushi/*` + `mushi-mushi` launcher)

Keywords have been populated. Now confirm each package README opens strong:

- [ ] Every SDK `README.md` leads with the canonical v2 hero (`MUSHI_TAGLINE_V2.hero`
  / `MUSHI_TAGLINE.full` in `@mushi-mushi/brand`): *"Your AI wrote it. Mushi tells
  you why it broke."* followed by the sub-hero *"Plain-English diagnosis + a
  paste-ready fix, right inside Cursor."* The legacy 12-word Sentry-contrast line
  is comparison-tables-only — never the opener. CI enforces the v2 hero on every
  primary README via `scripts/check-tagline-consistency.mjs`.
- [ ] 60-second install snippet immediately under the tagline. No wall-of-text.
- [ ] Link to the live demo above the API docs.
- [ ] Badges row: npm version, size (for web), LICENSE-MIT. Keep to 5 or fewer.

## 3. GitHub repo chrome (automated, ~30 seconds)

- [x] **About description, homepage, 20 topics, awesome-list good-first-issue** —
  applied via [`scripts/marketing/setup-github.mjs`](../../scripts/marketing/setup-github.mjs).
  Idempotent; safe to re-run any time the wording changes here.
- [x] **Social preview image** — generated to
  [`docs/social-preview/og-card.png`](../social-preview/og-card.png) (1280×640,
  matches the dark admin aesthetic).
  > One manual step left: GitHub doesn't expose a stable API for social preview
  > upload. Drop the image into Settings → Social preview by hand once.
- [ ] **Sponsor link** — already wired in `package.json` → `funding`.
  Confirm the sponsors tab on GitHub is live.

## 4. Live demo ([kensaur.us/mushi-mushi/](https://kensaur.us/mushi-mushi/))

The demo is the secret weapon — most OSS devtools don't have one. It has to
feel alive in the first 10 seconds.

- [ ] **First-visit banner** on the dashboard: *"Mushi mushi — I'm Mushi-chan.
  Click any tile to see what I caught today. 🐛"* (sets the voice immediately).
- [x] **Seeded demo content (script)** — five realistic, plausible bugs ready
  to fire via `node scripts/marketing/seed-demo.mjs` (covers all four
  classifier categories: bug / slow / visual / confusing). Each report carries
  a `seed_batch` tag so you can identify and clear the seed set later.
  > Set `MUSHI_API_KEY` and `MUSHI_PROJECT_ID` in `.env.local`, then run the
  > script. Re-run any time the demo data goes stale.
- [ ] **Dashboard empty states** — if nothing's there, Mushi-chan should say so:
  *"No bugs reported in the last 24h — maybe your users are happy, maybe
  they're stuck. The widget is on, I'm watching."*
- [ ] **One-sentence footer on every page**: *"This is a live demo seeded with
  realistic bugs. Your install starts at zero. [Get started →]"*

## 5. Bluesky + X handle (one-time, 10 minutes)

Reserve and wire both so the first launch-week posts land on accounts that look
cared-for.

- [x] **Bluesky soft-launch** — wired to `kensaurus.bsky.social` and posting via
  [`scripts/marketing/post-bluesky.mjs`](../../scripts/marketing/post-bluesky.mjs)
  using the staggered queue in [`./social/queue.json`](./social/queue.json). The
  intro Mushi-chan post is live at
  [bsky.app/profile/kensaurus.bsky.social](https://bsky.app/profile/kensaurus.bsky.social).
- [ ] **Bluesky brand handle** — reserve `mushimushi.dev` (matches the domain →
  automatic verification checkmark). When done, set `BLUESKY_HANDLE=mushimushi.dev`
  in `.env.local`, delete `.cache/bluesky-session.json`, and the next script run
  will mint a fresh session under the brand identity.
- [ ] **Self-label as a bot** — the script-posted account should mark itself in
  the bio (`bsky.app → Settings → Edit profile → Description`). E.g. *"Mushi
  Mushi maintainer · some posts via @mushi-mushi/cli."* Bluesky etiquette docs
  recommend this for any account that posts via the API.
- [ ] X / Twitter: `@mushimushi_dev` (the underscore because `@mushimushi` is
  probably taken; check both).
- [ ] Bio on both: *"Your AI wrote it. Mushi tells you why it broke — plain-English
  diagnosis + a paste-ready fix, in your editor. 🐛 OSS, self-hostable, MIT SDKs."*
- [ ] Profile image: Mushi-chan's happy cameo
  ([`docs/mascot/mushi-happy.png`](../mascot/mushi-happy.png)).
- [ ] Header image: same canvas as the GitHub social preview
  ([`docs/social-preview/og-card.png`](../social-preview/og-card.png)).
- [ ] Pin a post: 3-image thread with GIF + one-liner + "how it works in 60s".

## 6. Mascot set ([`docs/mascot/`](../mascot/))

- [x] `mushi-happy.png` — default avatar, gentle smile.
- [x] `mushi-worried.png` — big eyes, for "critical bug" posts.
- [x] `mushi-sleeping.png` — *All clear* moments, post-midnight posts.
- [x] `mushi-waving.png` — welcome posts, first-run tour.

All four shipped to [`docs/mascot/`](../mascot/) — character notes and
regeneration instructions live in [`docs/mascot/README.md`](../mascot/README.md).
PostHog's hedgehog is the direct precedent — *memorable weirdness compounds*.

## Finish line

When every checkbox above is ticked, the storefronts are ready. Only then start
[launch-week.md](./launch-week.md).

---

## 7. MCP registry + directory listings (diagnoses era)

The new front door is `npx mushi-mushi setup --ide` (the MCP-first install wizard).
These listings drive cold discovery for that path.

### MCP registry

- [ ] **[mcp.run](https://mcp.run)** — submit `mushi-mushi` as an MCP server.
  Entry template: name = "Mushi Mushi", description = "Bug-translation AI for vibe coders. Read live diagnoses and paste-ready fix prompts into Cursor / Claude Code without leaving the editor.", homepage = "https://mushimushi.dev", install = `npx mushi-mushi setup --ide`, features = `triage · fixes · inventory · setup`.
- [ ] **[smithery.ai](https://smithery.ai)** — same fields as mcp.run. Category: "Debugging / DevOps".
- [ ] **[cursor.directory](https://cursor.directory)** — list under "Developer Tools".
  1-liner: *"Mushi gives Cursor a `get_fix_context` tool — paste-ready root cause from user-reported bugs, no dashboard."*
- [ ] **[awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers)** — submit a PR adding
  Mushi under the "Development Tools" section. Title: `mushi-mushi — Bug translation for AI-native teams`.

### Open-source directories

- [ ] **[Awesome-Self-Hosted](https://github.com/awesome-selfhosted/awesome-selfhosted)** — submit under "Bug Trackers" or "Project Management". Self-hosted is MIT core + Docker Compose one-liner.
- [ ] **[OpenAlternative](https://openalternative.co)** — submit as alternative to Sentry. Comparison hook: "Sentry catches code errors. Mushi catches user-felt friction — then translates it into a paste-ready Cursor fix prompt."
- [ ] **[Product Hunt](https://producthunt.com)** — coordinate with `launch-week.md`. Ship on a Tuesday or Wednesday.
- [ ] **[Hacker News "Show HN"](https://news.ycombinator.com)** — title draft: *"Show HN: Mushi Mushi – open-source bug translator for AI-native teams (MCP-first)"*

### Build-in-public cadence

Post a "this week in Mushi" note every Friday on Bluesky / X. Template:

```
This week: [N] diagnoses processed across [M] projects.
Top error class: [X]. Fix rate: [Y]%.
What changed: [one shipped thing].
[link to changelog entry]
```

The numbers come from `GET /v1/admin/stats` (service-role) or the daily snapshot in `docs/stats.snapshot.json` (auto-updated by `scripts/marketing/update-stats.mjs`).

### MCP install deeplink format

The lean default install deeplink (in README + docs) should always use:

```
vscode://ms-vscode.codeinterpreter/mcp/install?url=https://registry.npmjs.org/@mushi-mushi/mcp&features=triage,fixes,inventory,setup,docs
```

Cursor deeplink:
```
cursor://anysphere.cursor-mcp-installer/install?url=https://registry.npmjs.org/@mushi-mushi/mcp&features=triage,fixes,inventory,setup,docs
```

`DEFAULT_FEATURE_GROUPS` in `packages/mcp/src/feature-groups.ts` is the canonical lean set — verified as `['triage', 'fixes', 'inventory', 'setup', 'docs']`. Do not expand the default without measuring context-window cost.
