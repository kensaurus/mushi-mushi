# I shipped a bug tool for 5 months and got 9 signups. Here's what the data said.

Source: https://kensaur.us/mushi-mushi/docs/blog/nine-signups-what-the-data-said

---
title: "I shipped a bug tool for 5 months and got 9 signups. Here's what the data said."
description: Five months after launch, Mushi Mushi had 30 npm packages, an MCP server in every registry and nine signups. What the data said, and what changed.
date: 2026-09-21
---

# I shipped a bug tool for 5 months and got 9 signups. Here's what the data said.

*Sep 21, 2026 · Kenji Sakuramoto*

---

The repo went public on 16 April 2026. On 20 September I ran the queries I
should have been running every Monday. Here is what came back, and then what
I think it means.

## The numbers

- **9** console signups, all time. Three in April, five in May, one in June,
  zero in July, August and September.
- **4** external projects created by those signups. **0** of them ever sent
  a report. The API keys were minted on day one and never seen again.
- **16** bug reports in the database, all from my own apps.
- **26,000** end-user sessions, all on my own apps.
- **3** GitHub stars.
- **100** repository views from **25** unique visitors in the last 14 days.
- **0** issues from anyone but me. **1** external pull request.

Against that: **30** published npm packages, and an MCP server listed in the
official registry, Glama, mcp.so, Smithery, cursor.directory and
awesome-mcp-servers.

I had built every surface a launch is supposed to land on. Nothing had landed
on them.

## Three things I found when I looked

**The launch never ran.** In June I wrote a five-day launch runbook: Show HN
on Tuesday, Product Hunt on Wednesday, Reddit across the week, a retro on
Friday. The five features it was built around shipped on schedule. The posts
did not. There is no Show HN, no Product Hunt listing and no Reddit thread
for this project anywhere. The public launch page said otherwise until this
week; it now says this.

**GitHub OAuth was off the whole time.** The console has a "Continue with
GitHub" button for a developer audience. The provider was never enabled in
the auth settings of the live project, so the button never rendered, and
every one of the nine signups used email and password. I found out by
reading the live auth config, not from any dashboard.

**The console was not measuring itself.** Mushi's own console is supposed to
run the Mushi SDK, so that "did the owner open the diagnosis" is a number.
The deployed console had never been given its own SDK key. The build pipeline
did not pass it. Dogfooding was silently off, and every funnel cell between
"signed up" and "paid" was blank.

## What the data said

Put together, the three findings are one sentence: I built distribution
surfaces, never ran the distribution, and could not see the funnel. The
registries and packages were real work, and I would do them again. But they
are where people arrive, not why they come, and without measurement I could
not tell the difference between "nobody came" and "people came and left".

The four external projects are the part that stings. Four strangers signed
up, created a project and got a key. None of them installed the SDK, or if
they did, it never sent anything. I do not know which, because the step
between "key minted" and "first report" was not instrumented.

## What changed

**One number.** The goal is now activated external projects per week: a
project owned by someone who is not me receives its first real bug report,
and the owner opens the diagnosis. Not signups (nine people did that and
none came back), not stars, not downloads.

**Measured with our own SDK.** The SDK grew a `track()` call and the console
grew a Users & Funnels page, and Mushi's own landing, docs and console emit
events through it. The company funnel is a query now. Zero is a value it
returns; "unmeasured" is not.

**First run rebuilt.** A new signup should see a diagnosis of a realistic
report in under a minute, before installing anything, and then be walked to
the install. That is the step the four external projects fell through, so it
is the step that got rebuilt first.

## What happens next

A Show HN, once a public gate list is true: the demo loads with no signup in a
private window, a fresh app reaches a diagnosis in under five minutes on
camera, the docs search returns no dead links, the legal pages exist, and the
activation query returns a number. The [launch page](/launch-week) lists the
gate so anyone can check it.

Whatever the numbers are afterwards, they go in the next post. If you have
shipped an app mostly written by an AI editor and hear about bugs from users,
I would like to know what you actually do with those messages. The
[Discussions board](https://github.com/kensaurus/mushi-mushi/discussions) is
the place; I reply on weekdays.
