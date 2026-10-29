# Mushi Mushi — know why your AI-built app broke, with the fix ready

Source: https://kensaur.us/mushi-mushi/docs

---
title: Mushi Mushi — know why your AI-built app broke, with the fix ready
description: "Your AI shipped it. Mushi Mushi tells you why it broke: a plain-English diagnosis and a ready fix in your editor. Open source, Sentry optional."
---

Your AI wrote it. Mushi Mushi tells you why it broke.</>}
  lead={LANDING_HERO.lead}
/>

## What it takes

- **No monitoring stack.** No Sentry, no logging service, no AI key of your own. Mushi's AI writes the diagnosis.
- **Free to start.** One app and 100 diagnoses a month with no card. Repeat reports of one bug count once.
- **Your AI does the fix, you approve it.** Mushi hands Cursor, Claude Code or Lovable the prompt. Nothing ships until you say so. If you let an agent open the fix as a pull request, a second AI reads it next to the original report and can refuse it: [here is one it held](https://github.com/kensaurus/mushi-mushi/pull/864).

## Why I built it

I build apps with Cursor and Claude Code, mostly on my own, and eight of them have real users. When one broke, I often didn't know where to start, because I hadn't written the code line by line.

So I built Mushi Mushi and ran it on all eight. In the 60 days to 2026-10-29, people sent 32 bug reports, and some of those were my own testing. My own checks (code audits, Sentry, the site watch, the first-time user test) found more than 1,000. Of the 234 fixes merged, one started from a user's report. [The live numbers are here](/proof).

That is why Mushi Mushi doesn't wait for reports: most people who hit a bug just leave.

It is early, and I'm still its main user. If something confuses you, [open an issue](https://github.com/kensaurus/mushi-mushi/issues) and I'll read it. — Kenji

## What this is (and is not)

Mushi Mushi is the bug mediator for AI-built apps, an open-source tool that gives every bug your users report a plain-English diagnosis + a ready fix, in your editor.

**Who it is for.** {LANDING_WHAT_THIS_IS.who} {LANDING_WHAT_THIS_IS.boundary}

**Where it stands.** Live and free to try: hosted service, npm packages and public source. Built by Kenji Sakuramoto, a solo developer in Japan ([kensaur.us](https://kensaur.us), [X](https://x.com/sakuramotokenji), [GitHub](https://github.com/kensaurus)), who runs it on his own 8 live apps; [the numbers are public](/proof), with bugs his own checks found counted apart from bugs people reported. Native iOS, Android and Flutter libraries are previews.

Words you will see on this page

- **Diagnosis**: Mushi's written explanation of one bug, with how serious it is, the likely cause and a suggested fix.
- **Fix prompt**: the diagnosis plus the evidence, written as instructions you paste into your AI editor.
- **SDK** or **script tag**: the small piece of code you add to your app. It shows the report button and sends reports to Mushi.
- **MCP**: the standard way AI code editors such as Cursor and Claude Code connect to outside tools. It is how your editor reads Mushi's reports.

More: [Who it’s for](/who-its-for) · [What else it does](/what-it-does) · [How a bug moves, step by step](/concepts/closed-loop) ·
[Sentry, Linear, Slack and other tools](/plugins) ·
[Compared with Sentry](/compare/sentry-vs-mushi) ·
[More ways to install](/quickstart) ·
[A tour of the console](/admin) ·
[Self-host](/self-hosting)
