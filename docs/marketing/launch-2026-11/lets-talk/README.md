# lets-talk launch kit (week of 2026-12-14)

lets-talk is a rehearsal coach for hard conversations: paste the message that
froze you and get replies you could send, check a draft before you send it, or
role-play the talk with an AI character who pushes back. It runs in the
browser with a guest try and no sign-up (`talk.kensaur.us`), and as an app.

**Angle:** The talk you keep putting off (the roommate and the dishes, the
raise, the apology) goes better the second time. lets-talk gives you a first
time that doesn't count.

## Claims you may use

| Claim                                                                                                                                              | Source                               | Checked    |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------- |
| Guest try with no account and no API key; AI coaching included on each device (about $0.50, 40 requests, per the README)                           | en full description; README glossary | 2026-11-14 |
| Advise: paste the line that froze you, see their side, pick a reply draft                                                                          | en full description                  | 2026-11-14 |
| Write: a draft scored on four parts (what happened, how you feel, what you need, a request), with a calmer rewrite beside it; Easy mode uses no AI | en full description                  | 2026-11-14 |
| Role-play: an AI character with a mood who "doesn't fold on the first try"; vibe meter; coach note each turn; session review                       | en full description                  | 2026-11-14 |
| Built on Nonviolent Communication                                                                                                                  | en full description                  | 2026-11-14 |
| Text goes to Anthropic only after you allow it; not stored on lets-talk's servers; drafts stay on the device                                       | en full description                  | 2026-11-14 |
| Seven languages: English, Japanese, Korean, Chinese, German, French, Spanish                                                                       | en full description                  | 2026-11-14 |
| "A practice tool for communication skills. It is not therapy or crisis support."                                                                   | en full description                  | 2026-11-14 |
| Play: "10+ downloads", no rating; App Store: "Not enough ratings"                                                                                  | live listings                        | 2026-11-14 |

Do not use: the Play package name (`howtotalktogirls`) or any dating framing.
The app was renamed to lets-talk on 2026-09-28 (ADR 0010), and the audit
notes the title can already read as a dating app.

## Where its users are, with evidence

Reddit rules read from `about/rules.json` on 2026-11-14. **Most communication
communities ban apps outright, several with a permanent ban on the first
offence.**

| Venue                 | Size       | Rule on your own app                                                                                                                                                                                                                                                                                             | Verdict                                                                                         |
| --------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Product Hunt          | n/a        | maker identified; no vote asks                                                                                                                                                                                                                                                                                   | **Main launch** (`01-product-hunt`), Tue 12-15                                                  |
| LinkedIn              | n/a        | normal; the owner has a profile                                                                                                                                                                                                                                                                                  | **Post** (`02-linkedin`): the raise and manager conversations                                   |
| X                     | n/a        | normal                                                                                                                                                                                                                                                                                                           | **Post** (`03-x-thread`)                                                                        |
| r/ClaudeAI            | 1,277,527  | "Promoting your project or paid service is encouraged if… clear project was built with Claude/Claude Code or specifically for Claude BY YOU… include a clear description of what was built, how Claude helped in detail… project must be free to try and say so (paid tiers OK)… promotional language mini[mal]" | **Post** (`04-reddit-claudeai`) if you can honestly describe how Claude was used in building it |
| r/socialskills        | 6,376,516  | "Do not submit product, app… or any other promotional content… will result in a permanent ban." Also no dating advice.                                                                                                                                                                                           | **Out**                                                                                         |
| r/communication       | 41,305     | "This is not a place to discuss or advertise technology that enables communication, such as… mobile apps"                                                                                                                                                                                                        | **Out**                                                                                         |
| r/relationship_advice | 15,915,301 | only specific advice requests; no spam; all bans permanent                                                                                                                                                                                                                                                       | **Out**                                                                                         |
| r/dating_advice       | 4,933,306  | "No spam, outside links, self-promotion"                                                                                                                                                                                                                                                                         | **Out**                                                                                         |
| r/AskMen              | 7,408,606  | no self-promotion "direct or indirect… start ups, product advertisement, coaches/gurus"                                                                                                                                                                                                                          | **Out**                                                                                         |
| r/socialanxiety       | 497,104    | "self help or therapy enterprise, app… instant and permanent ban"                                                                                                                                                                                                                                                | **Out**                                                                                         |
| r/selfimprovement     | 2,780,809  | "Absolutely no links of any kind… you may not mention your… app"                                                                                                                                                                                                                                                 | **Out**                                                                                         |
| r/AskManagers         | 97,548     | "No Self Promotion"                                                                                                                                                                                                                                                                                              | **Out**                                                                                         |
| r/roommates           | 21,327     | no rules listed in the API                                                                                                                                                                                                                                                                                       | Comments only. Answer a dishes thread with the four-part script itself, no link                 |
| r/NVC and similar     | —          | not checked (Reddit returned 429; r/NonviolentCommunication is 404)                                                                                                                                                                                                                                              | Read the sidebar before anything                                                                |

Honest summary: on Reddit, lets-talk can only help people in comments, with no
link. The posts go to Product Hunt, LinkedIn, X and r/ClaudeAI.

## Posts in this folder

| File                                                                            | Venue                           | When                                                |
| ------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------- |
| `rating-ask.en.paste.md`, `rating-ask.ja.paste.md` (rules: `../rating-asks.md`) | testers and anyone who wrote in | Mon 12-14                                           |
| `01-product-hunt.paste.md` + `.notes.md`                                        | Product Hunt                    | Tue 12-15, 00:01 PT (17:01 JST)                     |
| `02-linkedin.paste.md` + `.notes.md`                                            | LinkedIn                        | Wed 12-16, 08:00 JST (the evening before in the US) |
| `03-x-thread.paste.md` + `.notes.md`                                            | X                               | Wed 12-16, 23:30 UTC                                |
| `04-reddit-claudeai.paste.md` + `.notes.md`                                     | r/ClaudeAI                      | Fri 12-18, 14:00 UTC                                |

## Media shot list

| Use            | File (cooler-heads repo, `origin/main`)                                                                                                                                                     | Status    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| PH gallery 1   | **Record:** 20–30 s screen capture of a role-play: pick "the roommate who never does the dishes", send two messages, watch the vibe meter cool, open the coach note. Browser at phone size. | to record |
| PH gallery 2–4 | `docs/screenshots/advise-light.png`, `learn-light.png` (Write), `simulate-light.png`                                                                                                        | exists    |
| PH gallery 5   | `docs/screenshots/notes-light.png` (Field notes, no AI)                                                                                                                                     | exists    |
| LinkedIn image | `docs/screenshots/simulate-light.png`, or a frame from the clip                                                                                                                             | exists    |
| X post 1       | the role-play clip                                                                                                                                                                          | to record |

Use the light screenshots on Product Hunt and LinkedIn (white backgrounds).
Don't show a real person's messages in any capture; use the built-in scenes.

## Links (copy exactly)

| Venue                  | Link                                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product Hunt           | `https://talk.kensaur.us/?utm_source=producthunt&utm_medium=post&utm_campaign=launch-2611-ph`                                                                     |
| LinkedIn               | `https://talk.kensaur.us/simulate?utm_source=linkedin&utm_medium=post&utm_campaign=launch-2611-linkedin`                                                          |
| X                      | `https://talk.kensaur.us/advise?utm_source=x&utm_medium=post&utm_campaign=launch-2611-x`                                                                          |
| r/ClaudeAI             | `https://talk.kensaur.us/?utm_source=reddit&utm_medium=post&utm_campaign=launch-2611-claudeai`                                                                    |
| Play (in replies)      | `https://play.google.com/store/apps/details?id=us.kensaur.howtotalktogirls&referrer=utm_source%3Dproducthunt%26utm_medium%3Dpost%26utm_campaign%3Dlaunch-2611-ph` |
| App Store (in replies) | `https://apps.apple.com/app/id6799392790?pt=128720195&ct=launch-2611-ph`                                                                                          |

## Check it worked

| When                      | What                                                                                                   | Where                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 1 h after the Reddit post | visible signed out at `/r/ClaudeAI/new/`                                                               | private window                                                                                       |
| Launch day                | PH comments answered within the hour                                                                   | Product Hunt                                                                                         |
| Day 1, day 7              | "Activated" (first Easy Write score or first Advise submit, per the README glossary) from the campaign | the app's own funnel events; Mushi Mushi lets-talk project sessions (total only, no UTM capture yet) |
| Day 7                     | store installs by campaign `launch-2611-*`                                                             | Play Console; App Store Connect campaigns (5+ installs)                                              |

**Gate before this week:** the audit found that `/learn`, `/advise` and
`/simulate` serve 31–34-character shells to crawlers, and the store links are
JS-only below the fold. People in a browser still get the app, so the posts
work. Link previews may look empty, though. Paste each link into a LinkedIn
draft and an X draft first; if the preview card is blank, link the home page
instead.
