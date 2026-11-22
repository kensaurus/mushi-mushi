---
"mushi-mushi": patch
---

A new user's first ten minutes are clearer.

- **A disabled Dispatch fix says what it needs.** Thanks to [Adam](https://x.com/adamdotenv) for this and the four changes below. Under both Dispatch fix buttons on a report, the setup still missing is written out, each step a link, with a count: "To dispatch a fix: Connect GitHub · Index your code · Turn on Autofix (1 of 4 done)". "The story so far" names the same steps instead of telling you to click a button you can't click, and the setup card on the report no longer calls them optional.
- **One setup count everywhere.** The first-run screens said "Step 1 of 2" and "Step 2 of 2", the sidebar said "2 required setup steps remaining" and Home said "3 of 4 done". The first-run screens and the sidebar now use Home's 4-step count and words: "Set up · 2 of 4 done".
- **Journeys says what needs a key.** The map from real visits needs no key; only "Scan my site", which also maps pages nobody has visited yet, needs your own Firecrawl key. The page now says so.
- **A clean Free Check shows what passed.** It used to say only "Nothing to fix on the pages Mushi Mushi could read". It now says "No problems found on 3 pages", lists every check with a tick, a cross or "not checked", and names each page it read and any page it could not read, with the reason.
- **Self-host is easier to find in the README.** The top links say "Self-host with Docker", and the self-host section starts with the one-command Docker install.
