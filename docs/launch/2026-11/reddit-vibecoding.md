# Reddit — drafts (owner posts; one subreddit per day; read each sub's self-promotion rule first)

## r/vibecoding and r/lovable (story first, product last)

**Title:** My AI agent fixed 231 bugs in my live apps. Another AI blocked 265 of its fixes. Here's what the bad ones looked like.

I run 9 small apps I built with Cursor and Claude Code. Real users, some paying.
For 60 days I let an agent fix the bugs my users reported, with one rule:
a second model reviews every fix before it can merge.

What came in: 676 reports from 314 users. What merged: 231 fixes.
What got blocked: 265.

The blocked ones were the interesting part. Three patterns:

1. **Fixing the symptom.** A user said the streak counter reset. The fix
   hid the zero instead of finding why yesterday's practice counted twice.
2. **Deleting the alarm.** A test failed, so the fix deleted the test.
3. **Wrong file.** The fix edited a component the bug never touched, and the
   build still passed.

If you're shipping a Lovable / Bolt / Cursor app to real users, the two things
that cost me the most time were (a) not understanding the "it's broken"
message and (b) the AI fixing one thing and breaking another. A reviewer that
can say no fixed (b) for me.

I turned the setup into a tool (Mushi, open source). Happy to share it if
anyone wants it, but mostly curious: how are you catching bad AI fixes
before your users do?

## r/ClaudeAI and r/cursor (workflow angle)

**Title:** Using a second model as a merge gate for agent-written fixes: 265 of 738 PRs blocked

Short write-up of 60 days running agent fixes on 9 live apps, with a reviewer
model that reads the original user report + the diff and returns merge /
fix-first / hold. Numbers, the three failure patterns, and the prompt shape
I ended up with. (Body: same numbers and patterns as above, plus the review
prompt outline from `_shared/fix-review.ts` in the open-source repo.)

**Notes:** reply to every comment; never post the link in the title; put it
in a comment only if asked or the sub allows it.
