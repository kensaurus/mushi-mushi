# Mushi Mushi — one place to improve your AI-built app

Source: https://kensaur.us/mushi-mushi/docs

---
title: Mushi Mushi — one place to improve your AI-built app
description: "Your AI built it. Mushi Mushi makes it better: it finds what breaks, where people get stuck and what the code needs, then hands you the fix."
---

Your AI built it. Mushi Mushi makes it better.</>}
  lead={LANDING_HERO.lead}
/>

Words you will see on this page

- **Diagnosis**: Mushi Mushi's written explanation of one bug: how serious it is, the likely cause and a suggested fix.
- **Fix prompt**: the diagnosis plus the evidence, written as instructions you paste into your AI builder (Lovable, Bolt, Cursor or Claude Code).
- **Script tag** or **SDK**: the small piece of code you add to your app. It shows the report button and sends reports to Mushi Mushi.
- **Sentry**: a popular service that records errors when code crashes. You don't need it.
- **Pull request (PR)**: a proposed change to your code that you can read before you accept it.
- **MCP**: the standard way AI code editors such as Cursor and Claude Code connect to outside tools. It is how your editor reads Mushi Mushi's reports.
- **`npx mushi-mushi`**: the one command that adds Mushi Mushi to your app. You type it in your app's folder, or ask your AI editor to.
- **Journey map**: a picture of how people move through your app, and where they get stuck or leave.

More words, in plain English: [the glossary](/glossary).

## Will my customers actually report bugs?

You don't have to wait for them. Reporting takes one tap, and Mushi Mushi also looks for bugs itself: [check your live site free](/check?src=landing-customers), with no sign-up, or connect the [deeper checks](/what-it-does). [Where the bugs came from on my own apps](/proof).

## See it work, on a real bug

A real bug from Mushi Mushi's own app, from the report to the merged fix.

## What it takes

- **No monitoring stack.** No Sentry, no logging service, no AI key of your own. Mushi Mushi's AI writes the diagnosis.
- **Free to start.** One app and 100 diagnoses a month with no card. Repeat reports of one bug count once.
- **Your AI does the fix, you approve it.** Mushi Mushi hands Cursor, Claude Code or Lovable the prompt. Nothing ships until you say so. If you let an agent open the fix as a pull request, a second AI reads it next to the original report and can refuse it: [here is one it held](https://github.com/kensaurus/mushi-mushi/pull/864).

## Why I built it

I build apps with Cursor and Claude Code, mostly on my own, and they have real users. When one broke, I often didn't know where to start, because I hadn't written the code line by line.

So I built Mushi Mushi and run it on 9 of my own apps. What it found and fixed there, counted live: [the numbers are here](/proof).

## What this is (and is not)

Mushi Mushi is open source and one place to improve AI-built apps: fix bugs, smooth user journeys and clean up the code, each with a plain-English explanation and a fix your AI can apply.

**Who it is for.** {LANDING_WHAT_THIS_IS.who} {LANDING_WHAT_THIS_IS.boundary}

**Where it stands.** Live and free to try: hosted service, npm packages and public source. Built by one developer in Japan (Kensaurus 合同会社): Kenji Sakuramoto ([kensaur.us](https://kensaur.us), [X](https://x.com/sakuramotokenji), [GitHub](https://github.com/kensaurus)), who runs it on his own 9 live apps; [the numbers are public](/proof), with bugs his own checks found counted apart from bugs people reported. Native iOS, Android and Flutter libraries are previews.

More: [How it works, on video](/how-it-works) · [Who it’s for](/who-its-for) · [What else it does](/what-it-does) · [How a bug moves, step by step](/concepts/closed-loop) ·
[Sentry, Linear, Slack and other tools](/plugins) ·
[Compared with Sentry](/compare/sentry-vs-mushi) ·
[More ways to install](/quickstart) ·
[A tour of the console](/admin) ·
[Self-host](/self-hosting)
