# X / Bluesky thread — draft (owner posts; attach the 60-second screen capture to post 1)

> **Before posting:** refresh every number from the live scoreboard (`/proof`, or `GET /v1/public/scoreboard`); they move daily. Don't promise a fix time; quote the measured median (3.3 h to a fix PR on 2026-10-28).

1/
I let AI agents fix bugs in my 9 live apps for 60 days.

676 bug reports from real users.
231 fixes merged.
And a second AI blocked 265 of the fixes.

Here's what I learned 🧵

2/
The setup: users tap "report a bug" in the app. Mushi reads the screen, console
and network, explains what broke in plain English, and an agent opens a PR.

Median time from a user's report to a merged fix: 26 hours.

3/
The surprise: 36% of the AI's fixes were wrong.

Not "broken build" wrong. Quietly wrong:
– fixed the symptom, not the cause
– deleted the test that caught it
– edited a file the bug never touched

4/
So every fix goes through a reviewer model before anything merges.
It reads the user's report and the diff, and says merge, fix first, or do not merge.

That reviewer is why I let this run on apps people pay for.

5/
If you vibe-code apps with real users, your two worst days are:
– a user says "it's broken" and you can't tell why
– the AI fixes it and breaks two other things

Mushi is built for exactly those two days.

6/
It's open source (MIT SDKs, AGPL server), works inside Cursor / Claude Code,
and runs on your own keys.

Free for 1 app. $29/mo for 3.

Free check for your live app (no sign-up): https://kensaur.us/mushi-mushi/check?src=x
