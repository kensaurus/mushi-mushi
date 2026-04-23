---
"mushi-mushi": patch
---

Marketing automation toolkit (`scripts/marketing/`) + mascot kit + GitHub repo chrome live

Implements the automatable half of the [`docs/marketing/`](../docs/marketing/)
growth plan. Six zero-dep scripts that handle everything boring and
transactional, while keeping the relational parts (HN / Reddit / Product
Hunt / Discord engagement) where they belong — with a human, on the
keyboard, in the comments.

**Scripts (all under `scripts/marketing/`):**

- `setup-github.mjs` — sets repo About + 20 topics + opens the awesome-list
  contributor good-first-issue. Idempotent. **Already applied** to
  `kensaurus/mushi-mushi` (issue [#38](https://github.com/kensaurus/mushi-mushi/issues/38)).
- `seed-demo.mjs` — fires 5 realistic, classifier-spread bug reports
  (covers `bug`/`slow`/`visual`/`confusing`) into the live admin so first-time
  visitors land on a dashboard that looks alive. Tags every report with a
  `seed_batch` so the seed set is identifiable / sweepable.
- `post-devto.mjs <slug>` — publishes a markdown post under
  `docs/marketing/posts/<slug>.md` to dev.to via their first-class API.
  Drafts by default; `--publish` to go live. Re-runs UPDATE in place
  (matched by title) so we never duplicate articles.
- `post-bluesky.mjs` — drains
  `docs/marketing/social/queue.json` to Bluesky via the AT Protocol.
  Self-labels as a bot, persists session, computes rich-text facets for
  links + hashtags. Zero deps.
- `propose-awesome-pr.mjs` — one PR at a time: forks an awesome-list,
  alphabetically slots the Mushi entry into the named section, opens the
  PR with a thoughtful body. Explicitly NOT a bulk submitter — list
  maintainers reject those on sight.
- `record-readme-gif.mjs` — Playwright walks the live demo end-to-end
  (dashboard → reports → detail → fixes) and outputs
  `docs/screenshots/hero.{webm,gif,webp}` with palette-optimised ffmpeg
  conversion.

**Assets shipped:**

- `docs/mascot/` — four expressions of Mushi-chan (happy / worried /
  sleeping / waving), generated as a consistent character set with a
  README documenting palette, vibe, and regeneration prompt.
- `docs/social-preview/og-card.png` — 1280×640 dark-themed OG card with
  Mushi-chan + the *"Sentry sees what your code throws / Mushi sees what
  your users feel"* tagline, ready to drop into Settings → Social preview.

**Content seeded:**

- `docs/marketing/posts/01-auto-fix-loop.md` — first dev.to post, **already
  uploaded as a draft** to the kensaurus dev.to account (article #3539918,
  ready for human review + publish).
- `docs/marketing/social/queue.json` — first batch of 5 Bluesky posts in
  Mushi-chan's voice, ready to drain once `BLUESKY_HANDLE` is set.

**Deliberately NOT automated** (with rationale documented in
`scripts/marketing/README.md`): Hacker News / Reddit / Product Hunt /
LinkedIn / X / Discord posts, comment replies, and the actual launch.
Automating those would either trigger anti-spam stacks (HN, Reddit), violate
ToS (LinkedIn), require paid API access (X), or — most importantly —
destroy the authentic-presence value that makes those channels worth
posting on.
