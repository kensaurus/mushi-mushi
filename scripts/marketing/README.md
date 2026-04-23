# scripts/marketing/

Zero-dep automation for the boring, transactional parts of the
[`docs/marketing/`](../../docs/marketing/) growth plan. **Not** a
broadcast engine — Reddit, Hacker News, Product Hunt, Discord, and
LinkedIn are intentionally **not** here, because automating them
backfires (anti-spam triggers, ToS violations, and the loss of the
authentic-presence value that makes those channels worth posting on).

The split is:

| Layer | Who runs it | Why |
| --- | --- | --- |
| **Transactional** (this folder) | scripts | Settings, publishing scheduled content, demo seeding, image assets — boring, repeatable, no judgement needed. |
| **Relational** ([`docs/marketing/launch-week.md`](../../docs/marketing/launch-week.md)) | you, in person | HN/Reddit/PH posts and the 6 hours of comment replies that follow. The whole *point* is the reply, not the post. |

## What's in here

| Script | What it does | Needs |
| --- | --- | --- |
| [`setup-github.mjs`](./setup-github.mjs) | Sets repo About + 20 topics + opens the awesome-list contributor good-first-issue. Idempotent — safe to re-run any time. | already-authed `gh` CLI |
| [`seed-demo.mjs`](./seed-demo.mjs) | Fires 5 realistic, plausible bug reports into the live admin so first-time visitors land on a dashboard that looks alive. Tags every report with a `seed_batch` so you can identify them later. | `MUSHI_API_KEY` + `MUSHI_PROJECT_ID` |
| [`post-devto.mjs <slug>`](./post-devto.mjs) | Publishes [`docs/marketing/posts/<slug>.md`](../../docs/marketing/posts/) to dev.to. Drafts by default (`--publish` to go live). Re-runs update the existing post in place. | `DEVTO_API_KEY` (free at [dev.to/settings/extensions](https://dev.to/settings/extensions)) |
| [`post-bluesky.mjs`](./post-bluesky.mjs) | Posts the next due item from [`docs/marketing/social/queue.json`](../../docs/marketing/social/queue.json) via the AT Protocol. Self-labels as a bot, persists session in `.cache/bluesky-session.json`, respects rate limits. Flags: `--all` (drain queue), `--text "…"` (ad-hoc post), `--image=path --alt="…"` (attach image to ad-hoc post — JPEG/PNG/WebP/GIF, ≤1 MB), `--delete <at-uri>` (retract a post; auto-clears the matching queue entry so it can be re-posted). | `BLUESKY_HANDLE` (**full** ATProto identifier — `<name>.bsky.social` for the default suffix, or your custom domain like `mushimushi.dev`; *not* just the username) + `BLUESKY_APP_PASSWORD` (or `BSKY_API_KEY`). App password from [bsky.app → Settings → App passwords](https://bsky.app/settings/app-passwords). |
| [`propose-awesome-pr.mjs`](./propose-awesome-pr.mjs) | One-PR-at-a-time: forks an awesome-list, alphabetically inserts the Mushi entry into a named section, opens the PR. Reviews the diff before pushing. | already-authed `gh` CLI |
| [`record-readme-gif.mjs`](./record-readme-gif.mjs) | Playwright walks the live demo end-to-end (dashboard → reports → detail → fixes) and outputs `docs/screenshots/hero.{webm,gif,webp}`. | Playwright (already in `examples/e2e-dogfood`) + `ffmpeg` on PATH |

Every script accepts `--dry` to print the plan without sending. Every
script falls back gracefully when its credential is missing, so a fresh
clone can run them — just no-op until env vars land.

### Bluesky cadence convention

Items in `docs/marketing/social/queue.json` should carry a real
`scheduled_for` ISO timestamp staggered across days, not all `null`.
The script treats `null` as *post immediately*, so a queue full of nulls
turned loose with `--all` would fire 5 posts in 7 seconds — a Bluesky
account that does that gets de-ranked by the discovery feed within hours.

Recommended pattern: schedule the first post for "now", then space the
rest 1–3 days apart. Re-run `node scripts/marketing/post-bluesky.mjs`
(no flags) on each subsequent day; it picks the next due/unposted item,
posts it, and stamps `posted_at` + `uri` back into the queue so re-runs
are idempotent.

### Bluesky image attachments

Add an optional `image` block to any queue item to attach a single
illustration (Bluesky supports up to 4 per post; one is plenty for
launch-style cards):

```jsonc
{
  "scheduled_for": "2026-04-23T08:00:00Z",
  "text": "ok, proper hello 👋\n\n  $ npx mushi-mushi\n…",
  "image": {
    "path": "docs/marketing/social/images/launch-card.jpg",
    "alt": "Hand-illustrated Mushi-chan ladybug pointing at a terminal showing $ npx mushi-mushi …"
  }
}
```

Limits the script enforces before sending: ≤ 1 MB per image (Bluesky
hard cap), JPEG / PNG / WebP / GIF only. Pixel dimensions are read from
the file header so the post embeds with the correct aspect ratio (no
layout shift in the feed). Always write descriptive alt text — Bluesky
ranks accessible posts higher in the discovery algorithm and the alt is
read aloud verbatim by every screen reader.

The image lives next to the queue under [`docs/marketing/social/images/`](../../docs/marketing/social/images/),
so the path is short and the asset travels with the queue entry that
references it.

## What's deliberately not here

| Channel | Why it stays manual |
| --- | --- |
| Hacker News (Show HN) | HN actively shadow-bans automated submissions. The whole value of a Show HN post is sitting in the comments for 6 hours. |
| Reddit | r/webdev / r/reactjs have karma gates + AutoMod rules that flag obvious cross-posts. Anti-spam stack catches mechanical posts within 48h. |
| Product Hunt | API exists, but submissions are manually reviewed by the PH team and maker comments happen by hand anyway. |
| LinkedIn | API restricted to vetted partners (2026). Browser automation works but ToS-violating + algorithm downranks anything automated-feeling. |
| X / Twitter | Write API is paid (~$100/mo). Outside the zero-budget constraint. |
| Discord communities | Bots in `#showcase` channels get auto-flagged. The value of a Discord drop is the conversation that follows — not the link. |
| Comment replies | If we automated these we would lose the moat. Don't. |

## Typical week using this toolkit

```bash
# One-time, run on day 0
node scripts/marketing/setup-github.mjs
node scripts/marketing/seed-demo.mjs
node scripts/marketing/record-readme-gif.mjs

# Weekly, on Tuesday morning
node scripts/marketing/post-devto.mjs 02-pdca-admin-design --publish
node scripts/marketing/post-bluesky.mjs          # one due item per run — keep it humanly paced

# Whenever a new awesome-list contributor reaches out
node scripts/marketing/propose-awesome-pr.mjs --upstream agarrharr/awesome-cli-apps \
  --section "## Development" \
  --entry "- [Mushi Mushi](https://github.com/kensaurus/mushi-mushi) - …"
```

Then go reply to comments. That's the actual job.
