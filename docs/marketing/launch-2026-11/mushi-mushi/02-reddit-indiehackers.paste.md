My users reported 35 bugs in 60 days. My own checks found about 2,050. What I changed because of that.

I build and run nine small apps on my own, all written mostly with AI. Every app has a "report a problem" button. Over the last 60 days people pressed it 35 times, across all nine.

In the same 60 days, automatic checks and my own testing turned up about 2,050 reports. 526 fixes were merged in that time, and 2 of them started from a person's report.

What I took from it:

- Silence isn't health. People who hit a problem mostly just leave.
- So look at the live site the way a first visitor does, instead of waiting for someone to tell you.
- Fixes written by an AI agent need a second look against the original report. On my apps a second model said "hold" on 596 of 1,803 reviews.

I turned the tooling into an open-source product, Mushi Mushi: one place to find what breaks, where people get stuck and what the code needs, with the fix handed to your AI editor. I'm still most of its users, which is why I'm posting.

The part anyone can try without signing up is a check of a live site: https://kensaur.us/mushi-mushi/docs/check?src=reddit.indiehackers

What I'd like feedback on: does a free one-time check like that tell you anything you didn't know about your own site? And what would make you trust an AI-written fix enough to merge it?
