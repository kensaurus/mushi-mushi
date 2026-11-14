Show HN: Mushi Mushi – find what's broken or confusing in an AI-built app

I build apps with Cursor and Claude Code and run nine of them with real users. I didn't write most of that code by hand, so when something breaks I often don't know where to look. Mushi Mushi is the tool I built for that, and it runs on all nine.

It does three things:

1. Finds what breaks. A small report button for your users (one script tag, or one prompt in Lovable or Bolt), plus checks of the live site. Each report comes back as a plain-English cause and a fix prompt your coding agent can apply. An MCP server lets Claude Code or Cursor pull the report and the fix context directly.

2. Shows where people get stuck. It maps how visitors move through the app and flags dead ends, loops and pages people leave from, each with a suggestion.

3. Improves the code: known vulnerable dependencies, code audits and repo clean-up, as draft PRs you review.

What you can try right now, without signing up, is the check. Paste a live URL and it reads your home page and three pages it links to, the way a first visitor would, and tells you what is broken: pages that error or show nothing, dead links and images, a title still saying "Lovable App". Public pages only.

The numbers from my own apps over the last 60 days: people pressed the report button 35 times. About 2,050 reports came from automatic checks and my own testing. 526 fixes merged. Before merging, a second model reviews the fix against the report; it made 1,803 reviews and said "hold" 596 times.

The honest limits: I'm still most of its users. Setup has more steps than it should. The free plan covers one app and 100 diagnoses a month, and I pay for the model on those; the hourly site watch and the code audits need your own model keys or a local agent.

The SDKs are MIT and the server is AGPLv3; a separate enterprise folder is source-available. Self-hosting is free.

Try the check: https://kensaur.us/mushi-mushi/docs/check?src=hn.show
Live numbers: https://kensaur.us/mushi-mushi/docs/proof?src=hn.show
Code: https://github.com/kensaurus/mushi-mushi

I'd like to hear what the check misses on your site, and whether the plain-English diagnoses are useful or just noise.
