# LinkedIn — draft (owner posts; Tue–Thu morning JST or US morning)

> **Superseded 2026-10-29: do not post this.** Its numbers counted Mushi's own reports (a backlog import, AI audits, automated sweeps) as reports from users; only 32 of 669 came from people. Corrected numbers and the current drafts: [log/README.md](log/README.md).

> **Before posting:** refresh every number from the live scoreboard (`/proof`, or `GET /v1/public/scoreboard`); they move daily. Don't promise a fix time; quote the measured median (3.3 h to a fix PR on 2026-10-28).

A rescue developer charges about $3,500 to fix one broken AI-built app.
I wanted to know what it costs when an AI does it, with a second AI checking.

60 days, 9 of my own live apps:
• 676 bug reports from real users
• 231 fixes merged, median 26 hours from report to fix
• 265 fixes blocked by the reviewer before they could merge

The 265 matter most. AI-written fixes often look right and aren't: they hide
the symptom, delete the test, or change the wrong file. With a reviewer that
can say no, I let it run on apps people pay for.

I packaged it as Mushi: open source, runs on your own keys, works inside
Cursor and Claude Code. Free for one app, $29 a month for three.

If you run an app built with Lovable, Bolt, Cursor or Claude Code, there's a
free production check for your live site: kensaur.us/mushi-mushi/docs/check?src=li

#buildinpublic #vibecoding #indiehackers
