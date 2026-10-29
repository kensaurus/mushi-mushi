# Show HN — draft (owner posts; Tue or Wed, ~8am PT)

> **Superseded 2026-10-29: do not post this.** Its numbers counted Mushi's own reports (a backlog import, AI audits, automated sweeps) as reports from users; only 32 of 669 came from people. Corrected numbers and the current drafts: [log/README.md](log/README.md).

> **Before posting:** refresh every number from the live scoreboard (`/proof`, or `GET /v1/public/scoreboard`); they move daily. Don't promise a fix time; quote the measured median (3.3 h to a fix PR on 2026-10-28).

**Title (78 chars max):**
Show HN: I let AI fix 231 bugs in my 9 live apps – a second AI blocked 265

**URL:** https://kensaur.us/mushi-mushi/?src=hn

**First comment (post right after submitting):**

I build apps alone with Cursor and Claude Code. Nine of them are live, with
real users, and I kept losing afternoons to "it's broken" messages I didn't
understand, in code I didn't write by hand.

So I built Mushi. A user taps "report a bug" inside the app. Mushi reads the
report with the screen, console and network around it, explains what broke in
plain English, and an agent opens a pull request with the fix. Then a second
model reviews that PR against the report and the diff and either approves it
or says "do not merge".

The numbers from my own 9 apps over the last 60 days:

- 676 bug reports from 314 real users
- 231 fixes merged, median 26 hours from report to merged fix
- 738 reviews; 265 of them said "do not merge"

That last number is the one I care about. Most of the fixes an agent writes
look fine. A lot of them aren't: they paper over the symptom, delete a test,
or touch a file the bug never lived in. The reviewer is the reason I let this
run on apps people pay for.

What it is:
- SDK for web, React Native and Capacitor (MIT), server AGPL, self-host in
  one command
- Works from your editor: an MCP server and a Claude Code / Cursor plugin, so
  "why is this broken" is answered where you already are
- Your keys and your repo. Fix PRs run on your own AI/Cursor key; nothing
  merges without a passing review

What it isn't: an error tracker. It starts from what your users feel, not
from what your code throws, and works with no Sentry at all.

Free: 1 app. Builder is $29/mo for 3 apps. If you have a live app, there's a
free production check that reads your public pages and tells you what's
broken right now, no sign-up needed.

I'd love to hear where it falls over.

**Notes for the owner**
- Answer every comment for the first 3 hours; post the scoreboard link when
  someone asks for proof.
- Do not post the same day as the Reddit posts (HN dislikes cross-posting
  waves).
- Have one real before/after diagnosis ready to paste.
