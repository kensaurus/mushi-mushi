# Show HN: day-of reply guide (never paste this file)

**Write every reply yourself.** HN's guidelines: "Don't post generated text or
AI-edited text. HN is for conversation between humans." Each answer below is
the substance, with its source. Say it in your own words, shorter if you can.

## How to behave in the thread

From the Show HN rules and the general guidelines
(https://news.ycombinator.com/showhn.html, newsguidelines.html, read
2026-11-14):

- Answer every comment for the first 3 hours, then check every hour until
  bedtime.
- Agree with fair criticism first, then add what's true. Don't defend copy;
  fix the copy.
- Never ask anyone to upvote or comment. Never reply to a flag or downvote.
- If someone finds a bug, thank them, ask for the URL or steps, and post a
  follow-up comment when it's fixed. On HN that's the best reply there is.
- "I don't know yet" and "I haven't measured that" are good answers.

## The likely questions

### "How is this different from Sentry?"

- Sentry starts from what your code throws. Mushi Mushi starts from what a
  user or a first visitor runs into, including things that never throw: a
  dead link, a page that renders nothing, a flow people leave.
- It doesn't need Sentry. If you have Sentry, Mushi Mushi can take its issues
  in, so they land in the same queue with the same plain-English diagnosis.
- Sentry has its own AI fixer: Seer's Autofix "find[s] the root cause of
  issues and generate[s] code fixes" (https://docs.sentry.io/product/ai-in-sentry/seer/autofix/,
  read 2026-11-14). Fair to say so. The difference is the starting point and
  the audience: solo builders without a monitoring stack.
- Link: https://kensaur.us/mushi-mushi/docs/compare/sentry-vs-mushi?src=hn.show

### "PostHog already has 'Fix with AI'."

- True. PostHog puts a "Fix with AI" button on every error-tracking issue,
  which writes a fix or explain prompt for PostHog AI or a coding assistant
  (the PostHog error-tracking docs, as cited on
  https://kensaur.us/mushi-mushi/docs/compare/posthog-session-replay-vs-mushi, checked 2026-10-29).
- If you already run PostHog and your problems are errors, that may be
  enough. Mushi Mushi is for the person without that stack. It starts from a
  user's report or the live-site check. A second model reviews each fix
  against the report before merge.

### "Lovable already has 'Try to fix'."

- Lovable's "Try to fix" appears when a build error shows up while Lovable
  works. You get 10 free fixes, and after that they use credits
  (https://docs.lovable.dev/introduction/faq, read 2026-11-14).
- That catches build errors in the editor. Mushi Mushi catches what goes wrong
  for people on the published site: things that build fine and still don't
  work. It can hand the fix back to Lovable through its MCP connector
  (https://kensaur.us/mushi-mushi/docs/quickstart/lovable-mcp?src=hn.show).

### "Why not just ask Cursor or Claude Code?"

- You should. Mushi Mushi hands them the fix. What they can't do is tell you
  what's broken that nobody reported, or give you the user's screen, console
  and network around the moment it broke. That's the part Mushi Mushi
  collects. The fix prompt then goes into your editor through MCP.

### "What do you collect? Privacy?"

- The report button sends what the reporter chooses to send: a screenshot
  (which they see first and can remove), console and network excerpts, the
  page URL, the browser, and their own words.
- Report text and logs are PII-scrubbed before a model sees them. Model
  providers are listed by name in the privacy policy (Anthropic, OpenAI,
  OpenRouter). With your own model key, calls run on your account.
- You can self-host all of it.
- Free check: it reads public pages only.
- Links: https://kensaur.us/mushi-mushi/docs/legal/privacy?src=hn.show and
  https://kensaur.us/mushi-mushi/docs/self-hosting?src=hn.show
- Source: privacy policy v6, effective 2026-11-11, sections 2 and 5.

### "What does it cost?"

From https://kensaur.us/mushi-mushi/docs/pricing (read 2026-11-14):

| Plan      | Price  | What you get                                  |
| --------- | ------ | --------------------------------------------- |
| Free      | $0     | One app, up to 100 diagnoses a month, no card |
| Builder   | $29/mo | 3 apps, 1,000 diagnoses                       |
| Studio    | $79/mo | 10 apps                                       |
| Self-host | free   | bring your own model keys                     |

The hourly site watch and the code audits need your own keys or a local
agent.

### "AGPL? 'Open core'?"

- Yes, it's open core, and the root `LICENSE` says so.
- The SDKs are MIT, so your app's code isn't affected. The server is AGPLv3.
- `packages/server/ee/` is source-available, and production use of those
  enterprise features needs a license.
- Say it plainly; don't argue licensing philosophy.

### "So nobody but you uses it?"

- Mostly true, and the post says so. The numbers are from my own nine apps.
  The proof page splits user reports from automatic ones, so nothing is
  inflated: https://kensaur.us/mushi-mushi/docs/proof?src=hn.show
- That's why you're here: to find out what breaks for other people's apps.

### "Why only 35 user reports out of 2,000+?"

- Because users mostly don't report. That's the most interesting thing the
  data showed. Most of what got fixed was found by checks, not by people.

### "Is the reviewer the same model as the fixer? Doesn't it just agree?"

- Answer only with what you know about your own configuration. The data
  point: 596 holds out of 1,803 reviews in 60 days, so it does refuse.
- Point to a held PR that's public, for example
  https://github.com/kensaurus/mushi-mushi/pull/864 (held: the fix changed what
  a banner counts and never touched the list the report was about).

### "This post reads like AI wrote it."

- If you retyped it yourself, say so briefly and move on. Don't get defensive.

### "The check missed X" / "the check is wrong about Y"

- Thank them. Ask for the URL if they're happy to share it. Say whether X is
  in scope (public pages, home page plus three it links to). File it.

## Things not to say

- No traction claims beyond the scoreboard. No npm downloads, stars or MCP
  tool counts (PLAN.md "Stop doing" #3).
- Don't call the hourly watch, code audits or journeys free.
- Never a bare "Mushi". It's "Mushi Mushi".
- Nothing about investment, raising or investors.
