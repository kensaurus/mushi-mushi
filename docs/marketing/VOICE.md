# VOICE — how Mushi-chan talks

## Canonical tagline ladder (v2 — primary)

Import from `@mushi-mushi/brand` (`MUSHI_TAGLINE_V2` / `MUSHI_TAGLINE`). CI:
`scripts/check-tagline-consistency.mjs` fails stale variants; primary READMEs
should use v2 hero.

| Slot | Form | Use on |
|------|------|--------|
| Hero | *"Your AI wrote it. Mushi tells you why it broke."* | README headers, landing H1, docs landing |
| Sub-hero | *"Plain-English diagnosis + a paste-ready fix, right inside Cursor."* | Lead paragraphs under hero |
| Category | *"The comprehension layer for AI-built apps"* | Eyebrow, npm, llms.txt |
| Micro CTA | *"Know why. Fix fast."* | og:description, slide headers |
| Mark | *"虫虫"* | Logo-adjacent, footer whisper |

**Voice principles (v2):** plain over precise, momentum-obsessed, confident diagnosis,
playful-not-cutesy, anti-enterprise. Sell recovery speed — never lecture about testing discipline.

## Open by default (the OSS-powerhouse principle)

Mushi earns trust the way Langfuse and Supabase did: by being genuinely open,
not by claiming it. The proof points live in `@mushi-mushi/brand` (`MUSHI_OSS`)
so copy stays true to the code. Use them on README badge rows, the landing
trust strip, the docs open-source page, and anywhere a visitor is deciding
whether this is "real" open source.

- **Permissive core, no asterisks.** The JS/SDK packages are MIT; the server
  (Supabase functions + admin) is AGPLv3. Say the split plainly
  (`MUSHI_OSS.license`) — never imply "open" while gating the thing that matters.
- **Self-hostable, one command.** "Self-host the whole stack with one command"
  (`MUSHI_OSS.selfHost`). If the path regresses, fix the path, not the copy.
- **No lock-in.** "Your reports, your keys, your repo" (`MUSHI_OSS.noLockIn`).
  BYOK is the default, not an upsell.
- **Dogfood as proof.** "Mushi runs on Mushi" (`MUSHI_OSS.dogfood`). Every
  open-source claim should be backed by a real before/after from our own apps
  (`docs/dogfood.md`), the way Langfuse points at its own traces.
- **Anti-enterprise, still.** Open source is a trust move, not a "leverage the
  community" move. The banned-words list below applies here too.

## Legacy tagline ladder (v1 — comparison tables only)

Deprecated on primary surfaces. Keep for Sentry comparison tables and deep concept docs.

| Length | Form | Use on |
|--------|------|--------|
| 12 words | *"Sentry sees what code throws. Mushi sees what users feel — and closes the loop with AI."* | Comparison tables, evolution-loop essays |
| 5 words | *"Bug reports that close themselves."* | Legacy social bios until refreshed |
| 3 words | *"Capture. Classify. Fix."* | PDCA / team-grade CTAs |
| Sub-tagline | *"the evolution loop for AI-assisted software"* | Concept pages, not hero |

**Never write a variant** of either ladder. If none fits, use the closest canonical form.



Mushi-chan is the voice of the project. Not a brand persona you wheel out for
marketing — the actual narrator. Every README sentence, tweet, reply, changelog
blurb, error message, and cold DM goes through this filter.

If a sentence could have been written by any other SaaS, rewrite it.

## Who Mushi-chan is

- A small, friendly Japanese bug. 虫 (mushi) = bug; the doubling (虫虫 / むしむし)
  is a wordplay on もしもし ("moshi moshi"), the Japanese phone greeting — same
  cadence, but the も becomes む so it spells *bug-bug*. So Mushi-chan is *the
  bug that picks up the phone when your users feel one.* When we render the
  kana on a surface (footer, banner, snippet), it's always **むしむし**, never
  もしもし. The phone-greeting reference lives in our heads, not in the UI.
- Speaks English, sprinkles the occasional Japanese word. Never cosplay-anime
  heavy. One phrase per post, max.
- Has good taste. Points at real bugs, doesn't make up vague ones.
- Slightly self-deprecating. If something went wrong, Mushi-chan admits it first.
- Quietly confident. Never hypes. Never promises transformation.
- Technical. Knows the difference between a 500 and a 422 and cares about it.

## The voice in three sentences

> I'm Mushi-chan. I live in the corner of your app, and when a user wiggles
> their phone because something feels off, I write it down, screenshot it,
> classify it, and — if you ask nicely — open a fix PR. No pager, no shouting.

Read that out loud. If what you're about to publish doesn't sound like it
could live next to those three sentences, rewrite it.

## Lexicon

**Say these** — specific, honest, occasionally playful.

- "Mushi-chan caught…", "Mushi-chan noticed…", "Mushi-chan got confused by…"
- "user-felt bug", "user-friction", "the kind Sentry can't see"
- "shake to report", "quiet little widget", "tucked into the corner"
- "classified", "deduped", "judged", "dispatched a fix"
- "a small 🐛", "a cheeky one", "a sleepy one"
- "mushi mushi" / "むしむし" (only as a greeting, never as a CTA — the
  bug-bug, *not* the phone greeting)
- "itadakimasu" (before a launch — "ok, we eat")
- "otsukaresama" (after a big ship — "good work")

**Never say these** — corporate, tired, empty.

- "empower", "unlock", "seamless", "elevate", "leverage", "revolutionize"
- "the leading", "best-in-class", "next generation", "AI-powered ✨"
- "game changer", "disrupt", "10×", "synergy"
- "delightful user experience" (just say what happens)
- "we're excited to announce" (just announce it)
- "book a demo" (the live demo is one click; link to it)

**Structural rules**

- Lead with the verb or the noun, not with "We" or "Today".
- One idea per sentence. If there are two, make it two sentences.
- Specifics over adjectives. "Classified in 1.8 seconds" beats "classified quickly".
- Numbers in copy should be real numbers from the live dashboard, not rounded marketing.
- No em-dashes followed by a corporate value-prop. (The em-dash is allowed; what
  comes after it has to stay concrete.)
- Emoji budget: 🐛 🪲 ⭐ 🌱 🍵 🏯. One per post, not a parade.

## Examples

### BAD — corporate, AI-shaped, empty

> 🚀 Excited to announce Mushi Mushi — the next-generation, AI-powered user
> feedback platform empowering developers to seamlessly capture and resolve
> user-felt bugs at scale. Book a demo today!

### GOOD — Mushi-chan

> Mushi mushi. I'm Mushi-chan, a small bug who lives in your app.
> When a user shakes their phone because something feels off, I write it
> down, classify it, and — if you like — open the fix PR. Sentry catches
> crashes; I catch the 12-second-loading screens, the dead buttons, the
> checkout that quietly confuses everyone. The widget is 14 KB gzipped.
> Try it: `npx mushi-mushi`. 🐛

### BAD — Reddit spam, no credibility

> Hey r/webdev, check out my tool Mushi Mushi, the best bug reporting
> solution for React developers! Click the link to learn more!

### GOOD — Mushi-chan on Reddit

> I've been running Sentry on a side project and kept noticing a gap —
> Sentry sees what my code throws, but not what my users *feel*. (Dead
> buttons, slow screens, layouts that break on one Android.) So I spent
> three months building the thing I wanted: a shake-to-report widget plus
> an LLM-native classifier that can optionally open a fix PR on GitHub.
> It's OSS (MIT on the SDKs), 14 KB gzipped on the client, and there's a
> live demo if you want to poke around: \<link\>. Happy to take hate.

### BAD — product-update tweet

> 🎉 New release! v0.5 introduces powerful new capabilities to supercharge
> your bug triage workflow with AI-powered insights. 🚀✨

### GOOD — Mushi-chan on Bluesky

> v0.5: I learned a new trick. When the Do stage backs up, I draw a little
> marching-ants ring around it on the dashboard so you can see the
> bottleneck without reading anything. 🐛 (changelog: \<link\>)

## Mushi Bounties — sub-product voice

**Canonical name:** "Mushi Bounties" (full), "Bounties" (inside the console).
**Never say:** "earn Amazon gift cards" (Amazon's terms forbid framing cards as cash-equivalent).
**Always say:** "100+ rewards including Amazon" or "earn points, redeem for rewards".
**Legal posture note:** rewards are closed-loop mushi-points redeemable at a 1.3× premium for
Mushi Pro, or at base rate for third-party gift cards via Tremendous ($599/yr cap per tester;
Tremendous holds the money-transmitter licenses). No crypto. No cash from Mushi directly.
Consult `docs/research/tester-marketplace-research-2026-05-22.md` §6, §9 before launch copy.

### Three-persona Bounties phrasebook

| Audience | What they want to hear | How Mushi-chan says it |
|---|---|---|
| **Dev/PM publisher** | "My app gets tested by real humans who are paid to find bugs." | "Publish to Bounties. Real testers, tracked in your Sentry inbox, with points they actually want." |
| **Dev/PM tester** (also uses the console) | "I can hunt bugs on other people's apps and earn credit for my own Mushi Pro." | "Test other teams' apps. Every accepted bug report earns mushi-points. Redeem at a 30% premium on your own Pro plan — or cash out to a gift card." |
| **Public tester** (non-dev) | "I get paid to find bugs in apps." | "Pick an app. Find a bug. Earn rewards — pick from 100+ options including Amazon, Starbucks, App Store." |

**Tone note for Bounties copy:** slightly higher energy than the base Mushi-chan voice — testers
need motivation. But still no hype. "Real testers find real bugs" is fine; "unlock unlimited earning
potential" is not.

## Three-persona phrasebook

The same feature, phrased for each of the three personas. Use this as a
lookup when writing copy for a feature that could resonate differently.

| Feature | Vibe coder | AI-native dev team | PM / founder |
|---------|------------|-------------------|--------------|
| **The loop** | "My users report, my agents fix — I just ship." | "Our agents write code. Mushi tells them which bugs to fix next and scores their PRs." | "I get bug + feature signal direct from users. The cheap ones fix themselves." |
| **Shake-to-report** | "Drop in 14 KB. Every shake is a classified ticket." | "Event source: the SDK. Every shake triggers a classify → fix pipeline step." | "No support queue. Users shake instead of complaining on Reddit." |
| **BYOK** | "My Anthropic key. My data. My bills." | "All LLM calls run under your project key — zero platform data exposure." | "Your users' data never touches Mushi's cloud LLM account." |
| **Lesson library** | "My agents learn from every fix I merge." | "The lesson library feeds the system prompt — each fix makes the next one smarter." | "Fewer repeat bugs means fewer repeat escalations." |
| **Judge scores** | "My fix either ships or I know why it didn't." | "Judge scores gate prompt promotions — the quality ratchets up over time." | "I can see whether the auto-fix quality is improving week over week." |
| **MCP server** | "`get_fix_context` in Cursor before touching any file." | "One MCP install, every agent workflow — Cursor, Claude Code, Continue, Zed." | "Our Cursor-native engineers already have the fix context when they open a PR." |
| **QA coverage** | "QA runs automatically after every fix. I never asked for it." | "Playwright / Browserbase stories verify each fix attempt before the judge scores it." | "Fewer regressions reaching users — the loop self-polices." |
| **Privacy** | "My code stays in my repo. My keys stay in Vault." | "RLS-per-project, signed-URL screenshots, PII scrubbed at ingest." | "GDPR-friendly story: no user data in third-party LLMs unless the customer opts in." |

**Usage rule:** write the copy for the persona the surface is targeting,
then read it out loud as Mushi-chan. If it sounds like a slide deck, rewrite it.

## A quick test before you post

Ask yourself:

1. Could a real person say this out loud without cringing?
2. Is there a specific noun or number in here, or only adjectives?
3. Does it sound like *me* (or Mushi-chan), or like LinkedIn?
4. Would I read past the first line if I scrolled past it?

If any answer is no, rewrite it.
