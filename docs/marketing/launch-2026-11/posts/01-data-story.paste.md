Users don't report bugs. On my 9 live apps, people sent 34 reports in 60 days.

I run nine apps that I built with AI. Each one has a small "Report a problem" button from Mushi Mushi, the open-source tool I make.

In the 60 days to 11 November 2026, people tapped that button 34 times. That is 18 different people, and my own testing is counted in it.

Over the same 60 days, 2,031 other bug reports came in. They came from automatic code reviews, Sentry errors, security advisories, a check of each live site, test browsers, and bugs I filed by hand.

523 fixes were merged. 2 of them started from a person's report.

So silence does not mean your app works. Most people who hit a bug don't write to you. They leave.

These are the kinds of things people hit and almost never report. I found all of them on real, live apps built with AI:

- a link in the footer that goes to a "page not found"
- a page whose title is still "Lovable App"
- a price shown as "$$36"
- a contact form whose captcha never loads

If you built your app with Lovable, Bolt, Cursor or Claude Code, here is what you can do today, for free:

1. Check your live site. Paste your URL, no sign-up: https://kensaur.us/mushi-mushi/docs/check?src=devto.datastory
   It looks for what a visitor would run into: broken links and images, pages that don't load, placeholder titles, errors when the page opens.

2. Add the report button, so the few people who do speak up reach you. In Lovable or Bolt it is one prompt: https://kensaur.us/mushi-mushi/docs/quickstart/lovable-bolt?src=devto.datastory
   Each report comes back as a short explanation in plain English, plus a fix your AI builder can apply. It's free for one app, and Mushi Mushi pays for the AI.

3. Connect GitHub when you want to. Mushi Mushi then also scans your code for packages with known security holes.

To be fair about my own numbers: most of the 2,031 came from checks a new account doesn't get on day one. The hourly site watch needs your own key for a web-reading service, and the code reviews run on my own machine. I'm telling you that so the free part above isn't oversold.

The numbers update live here: https://kensaur.us/mushi-mushi/docs/proof?src=devto.datastory
