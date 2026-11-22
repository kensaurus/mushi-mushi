# Notes: lets-talk on r/ClaudeAI (never paste this file)

Paste file: `04-reddit-claudeai.paste.md`. Line 1 is the title.

## The rule that allows it (read 2026-11-14)

"Showcase your project in a way that helps educate and inspire others:
Promoting your project or paid service is encouraged if it fit the following
criteria: _ clear project was built with Claude/Claude Code or specifically
for Claude BY YOU _ include a clear description of what was built, how Claude
helped in detail, and what it does _ project must be free to try and say so
(paid tiers OK) _ promotional language mini[mal]…"

The draft covers: built by you, specifically on Claude, what it does, how
Claude is used, "Free to try" stated, minimal promotion. Use the
"Built with Claude" (or the nearest) flair.

## Check before posting (only you know these)

- **The role-play bullet** comes from `src/features/simulation/system-prompt.ts`
  (2026-11-14): starting tension 0–100, a private character trait graph, "Dual
  channels" (chat in character; the `reportMood` tool feeds the UI), and the
  quoted rule "Healing is gradual — don't instantly go to zero after one good
  line." Quoting one line of your prompt is fine; don't paste the whole thing.
  If you have a real story of what went wrong before that rule, add it. This
  sub rewards real lessons.
- **If you built it with Claude Code,** add one or two concrete lines on how.
  The rule counts "built with Claude Code" as well as "built for Claude".
- **Models:** the BYOK picker lists `claude-opus-5` (default), `claude-sonnet-5`
  and `claude-haiku-4-5` (`src/features/byok/model-picker.tsx`, 2026-11-14).
  Update if the picker changed.
- **Structured scoring:** `src/features/nvc-learn/score-response.ts` streams
  structured fields for progressive UI. True on 2026-11-14.
- **Rewrite in your own words.** r/ClaudeAI has no AI-text rule in its list,
  but a Claude-written post about Claude invites that comment.

## Timing

Fri 2026-12-18, 14:00 UTC (23:00 JST). Stay 2 hours.

## What to reply

Prompting questions: answer generously; that's the point of the sub. Cost
questions: the guest allowance is about $0.50 of AI use per device (README
glossary). Don't share the system prompt verbatim if it's the product's core;
describe the approach.

## Visibility and measure

Check `/r/ClaudeAI/new/` signed out after 1 hour. Campaign
`launch-2611-claudeai`.
