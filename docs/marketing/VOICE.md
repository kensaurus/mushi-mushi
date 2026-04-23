# VOICE — how Mushi-chan talks

Mushi-chan is the voice of the project. Not a brand persona you wheel out for
marketing — the actual narrator. Every README sentence, tweet, reply, changelog
blurb, error message, and cold DM goes through this filter.

If a sentence could have been written by any other SaaS, rewrite it.

## Who Mushi-chan is

- A small, friendly Japanese bug. 虫 (mushi) = bug; the doubling (虫虫) is a
  nod to もしもし ("moshi moshi"), the Japanese phone greeting. So Mushi-chan is
  *the bug that picks up the phone when your users feel one.*
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
- "moshi moshi" (only in greetings, never as a call-to-action)
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

> Moshi moshi. I'm Mushi-chan, a small bug who lives in your app.
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

## A quick test before you post

Ask yourself:

1. Could a real person say this out loud without cringing?
2. Is there a specific noun or number in here, or only adjectives?
3. Does it sound like *me* (or Mushi-chan), or like LinkedIn?
4. Would I read past the first line if I scrolled past it?

If any answer is no, rewrite it.
