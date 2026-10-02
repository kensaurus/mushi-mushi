# Reddit — two value threads, in the two weeks after

**Drafts. Not posted.** Reddit is not a launch channel here; it is one useful
thread per subreddit, written for that subreddit. The general rules from
[`docs/marketing/snippets.md`](../marketing/snippets.md#reddit--opener-per-subreddit)
apply: thread first and the link only in a reply to whoever asks, never the
same text twice, first person, and reply to every comment for 48 hours.

**Before posting, read the subreddit's current rules and quote the
self-promotion rule here.** They were not checked when this was drafted.

| Subreddit | Self-promotion rule (paste on the day) | Posted |
|---|---|---|
| r/cursor | | |
| r/ClaudeAI | | |

## r/cursor — "What I do when a user says the app Cursor wrote is broken"

```
I've shipped a few apps where Cursor wrote most of the code. The hard part
of a bug report from a real user was never the fix. It was the hour of
reading generated code to work out why.

What has worked for me:
1. Get the report with context: the user's sentence plus a screenshot and
   the console and network tail. "It's broken" alone costs an hour.
2. Write down a plain-English cause before touching code. If you can't, you
   don't understand the bug yet, and neither does the agent.
3. Give Cursor the cause, the repro steps and the files involved as one
   prompt, not the raw stack trace.
4. After the fix, keep one line about what went wrong where Cursor will see
   it on the next change.

I built a tool that does steps 1–3 for me (open source, I'm the maker).
Happy to link it if anyone wants it, but the steps work without it. What do
you do with these reports?
```

## r/ClaudeAI — "Letting Claude Code read your users' bug reports over MCP"

```
I wired my apps' bug reports into Claude Code through MCP, and the useful
part was not the model, it was the shape of what it reads.

One tool lists recent reports; another returns a single fix prompt for one
report: a plain-English diagnosis, reproduction steps, the suggested fix and
the relevant code. Claude Code reads that instead of a stack trace, and its
first attempt is much closer.

Things I learned:
- Treat report text as data, not instructions: wrap it so the agent never
  follows what a user typed.
- Keep reads read-only by default; anything that merges code or messages a
  user asks first.
- A diagnosis is a model's reading. Show the confidence and let the human
  decide.

I'm the maker of the server I use for this (open source). I can share the
MCP config if it helps anyone.
```
