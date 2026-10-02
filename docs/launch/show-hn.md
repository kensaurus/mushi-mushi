# Show HN — Day 2 (Tuesday, 12:00–17:00 UTC)

**Draft. Not posted.** Rewrite it in your own words before posting: HN removes
posts that read as AI-written. Facts come only from the verified rows of the
[claims table](./README.md#claims-table).

## Rules that apply (news.ycombinator.com/showhn.html, read 2026-10-02)

- Show HN is "for something you've made that other people can play with".
- Sign-up pages and landing pages are off-topic. Keep barriers like sign-ups
  out of the way. So the URL is the **no-signup demo**, never the landing page.
- "Please don't ask friends to upvote or comment." No vote asks anywhere.

## URL

`https://kensaur.us/mushi-mushi/docs/connect?utm_source=hn&utm_medium=post&utm_campaign=launch-week-2026-10`

On 2026-10-02 the demo's read-only key returned diagnosed reports from the
public `mushi-demo` project. Re-check it in a private window the morning you
post. If it fails, do not post that day.

## Title (pick one, under 80 characters)

- `Show HN: Mushi – bug reports from your users, explained in plain English`
- `Show HN: A bug widget that tells you why your AI-written app broke`

## First comment (post it yourself right after submitting)

```
Hi HN, I'm Kenji. I build this alone.

I ship apps that Cursor and Claude Code wrote most of. When a user writes
"it's broken", I lose an afternoon reading code I didn't write. Mushi is my
attempt to have the report arrive already explained.

How it works: a widget in your app (web, React Native, Capacitor) lets a user
report a bug in a sentence. Mushi attaches the screenshot and the console and
network tail, and a model writes a diagnosis: a plain-English title, a
severity, the likely cause and a suggested fix. Your coding agent pulls it
over MCP: get_recent_reports, then get_fix_context returns one fix prompt.
The MCP server needs no LLM key of its own.

The demo needs no signup. It installs read-only MCP access to a demo project
in Cursor, Claude Code or another client, so you can ask your editor what is
broken there. The reports in it are samples I wrote; the diagnoses are real
model output.

Open source: SDKs MIT, server AGPLv3, self-hosting is one command. Hosted
free tier: 50 diagnoses a month, no card.

If you already run Sentry: it starts from what the code threw. Mushi starts
from what the user reported, can take Sentry's errors into the same queue
through an issue-alert webhook, and resolves the Sentry issue when the fix
merges. Use it instead or alongside.

Where it stands: [N from the scorecard] signups, [N] outside projects that
have sent a real report. What I'd most like is someone to point it at an app
I've never seen and tell me where the diagnosis was wrong.

Known limits: a diagnosis is a model's reading and can be wrong. Docs are
English only. File references need the repo indexed first. The native iOS,
Android and Flutter SDKs are a preview that installs from the repo.

Install: npx mushi-mushi
Repo: https://github.com/kensaurus/mushi-mushi
```

## While it is up

- Reply to every comment for the first two hours, then hourly. Never "we".
- Sentry comparisons get the canonical answer from VISION.md §1.6, word for
  word.
- Questions about users get the scorecard number of the day, not a feeling.
- Do not resubmit if it falls off. The thread is the asset either way.
