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
- [ ] **Enhance README screenshots with `docs/screenshots/hero-gif.webp`** — use
  `<picture>` with `source srcset="…hero-gif.webp"` + `<img src="…report-detail-dark.png">`
  so the static image still renders in RSS/email clients.
- [ ] **Pin a `good first issue`** — "Submit Mushi to an awesome-* list". See
  [drip-channels.md](./drip-channels.md) for the list.

## 2. npm pages (`@mushi-mushi/*` + `mushi-mushi` launcher)

Keywords have been populated. Now confirm each package README opens strong:

- [ ] Every SDK `README.md` starts with the tagline: *"Sentry sees what your
  code throws. Mushi sees what your users feel."*
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

- [ ] **First-visit banner** on the dashboard: *"Moshi moshi — I'm Mushi-chan.
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
- [ ] Bio on both: *"Bug reports that fix themselves. Sentry sees what your
  code throws. Mushi sees what your users feel. 🐛 OSS, MIT."*
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
