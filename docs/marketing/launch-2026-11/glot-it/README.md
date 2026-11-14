# glot.it launch kit (week of 2026-11-23)

glot.it teaches Thai with tone feedback. It is the only one of the six apps with
traction, so this week builds on what already works: Thai learners who search
for tones.

**Angle:** Thai tones are silent mistakes. Nobody corrects you, so you keep
saying "dog" when you mean "horse". (Before the product name: the learner
already knows this problem.)

## Claims you may use

Every line was checked on 2026-11-14. Anything else needs a live check first.

| Claim                                                                                                                                                               | Source                                                | Checked                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------- |
| All 161 lessons are free; Pro lifts the daily AI limits and adds offline downloads                                                                                  | https://kensaur.us/glot-it/pricing                    | 2026-11-14                            |
| On web, iOS and Android                                                                                                                                             | Play listing, App Store listing, `kensaur.us/glot-it` | 2026-11-14                            |
| No ads inside a lesson (use exactly this; a bare "no ads" isn't documented)                                                                                         | `docs/growth/gtm-plan-2026-q4.md:157`                 | repo only                             |
| Drills include tone ID; speaking practice records you and AI scores it; FSRS spaced review; 12 conversation scenarios with a voice tutor; free tutor 10 turns a day | glot.it `README.md`                                   | repo only                             |
| Play: "500+ downloads", no rating yet                                                                                                                               | Play listing (US)                                     | 2026-11-14                            |
| App Store: "Not enough ratings"                                                                                                                                     | App Store listing (US)                                | 2026-11-14                            |
| Ranks #18 on Play US for "learn thai"                                                                                                                               | growth audit 2026-11-14                               | audit only; re-check before quoting   |
| 92 acquisitions, 117 monthly devices in 28 days                                                                                                                     | growth audit 2026-11-14                               | audit only; don't put in public posts |

Do not use:

- **The domain `glot.it`.** It is a parked domain the owner does not control
  (`docs/growth/gtm-plan-2026-q4.md` §8; it did not resolve on 2026-11-14).
  Always link `kensaur.us/glot-it`. On X and Reddit, write the name as
  "glot.it" only where it can't turn into a link. If the compose preview shows
  it as a link, write "glot it" or "the app" instead.
- **"162 lessons"**, which is still in the README and `docs/growth/aso-listings.md`.
  The pricing page says 161.
- **"Duolingo has no Thai course".** It is in the Q4 plan but was not
  re-verified for this kit.

## Where Thai learners are, with evidence

Reddit rules were read from each sub's `about/rules.json` on 2026-11-14,
through the owner's signed-in session. Firecrawl refuses Reddit, and anonymous
reads now hit a login wall. Sizes are Reddit's subscriber counts that day.

| Venue                  | Size             | What the rules say about your own app                                                                                                                                                                                                                              | Verdict                                                                            |
| ---------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| r/learnthai            | 33,131           | "Advertising is not allowed with the exception of Thai learning resources that are free or largely free. Example. An application that is free to download and use but has in app purchases is allowed." Text posts only. No surveys. No Discord or Telegram links. | **Post** (`01-reddit-learnthai`)                                                   |
| r/Thai                 | 40,687           | "Advertising and self-promotion are strictly prohibited… Educational or charitable exceptions require moderator approval _before_ posting."                                                                                                                        | Ask the mods first (modmail draft in `01` notes); comments only until they say yes |
| r/Thailand             | 963,722          | "Spam, self-promotion… advertisements for products and services, self-promotion" are removed. ChatGPT-pasted comments removed.                                                                                                                                     | **No posts.** Answer language questions in comments, no link                       |
| r/ThailandTourism      | 1,215,181        | Own blog or video links OK unless "you are posting your own content for promotional purposes and have a history of doing so"                                                                                                                                       | Comments only. A "phrases for your trip" thread answer, no link                    |
| r/languagelearning     | 3,415,932        | "Do not submit self-owned content without permission", and separately disallows "AI language learning tools or chatbots" and posts focused on one language                                                                                                         | **Out.** glot.it has an AI tutor and is Thai-only                                  |
| r/solotravel           | 4,594,754        | "No self-promotional content… (including surveys, app development, and market research)"; AI-written content removed as spam                                                                                                                                       | **Out**                                                                            |
| r/travel               | 14,506,653       | Bans "side projects" and "(even for free sites/apps)"; "Absolutely no AI": 28-day ban, then permanent                                                                                                                                                              | **Out**                                                                            |
| r/digitalnomad         | 2,433,168        | "Links to blogs, product launches… will be removed. No exceptions"                                                                                                                                                                                                 | **Out**                                                                            |
| r/Bangkok, r/chiangmai | 189,101 / 51,649 | Bangkok: no AI content at all; no ads. Chiang Mai: self-promo only as part of a discussion                                                                                                                                                                         | Comments only, as a resident would                                                 |
| Thai learners on X     | not measurable   | Normal X rules                                                                                                                                                                                                                                                     | **Post** (`02-x-thread`). Tags people use: #learnthai, #ภาษาไทย                    |
| Product Hunt           | n/a              | Maker must say they're the maker; no vote asks                                                                                                                                                                                                                     | Optional (`03-product-hunt`), only after the Reddit post lands                     |

Not checked (Reddit returned 429): r/Thaiforeigners. Read its sidebar before
posting there.

## Posts in this folder

| File                                                                            | Venue                                | When                                        |
| ------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------- |
| `01-reddit-learnthai.paste.md` + `.notes.md`                                    | r/learnthai                          | Tue 11-24, 13:00 UTC (22:00 JST)            |
| `02-x-thread.paste.md` + `.notes.md`                                            | X (the owner's account)              | Wed 11-25, 00:30 UTC (09:30 JST)            |
| `03-product-hunt.paste.md` + `.notes.md`                                        | Product Hunt                         | Optional; held until the app has 5+ ratings |
| `rating-ask.en.paste.md`, `rating-ask.th.paste.md` (rules: `../rating-asks.md`) | personal messages to active learners | Mon 11-23, before the posts                 |

## Media shot list

Attach existing files first; record only what is missing.

| Use                                                                            | File (glot.it repo, `origin/main`)                                                                                                                               | Status                |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Reddit post image (optional; r/learnthai is text-only, so put it in a comment) | `docs/screenshots/23-tone-training-light.png`                                                                                                                    | exists                |
| X post 1                                                                       | **Record:** 15 s phone screen capture of a tone drill. Get one wrong, show the correction, get it right. No music, captions burned in ("wrong tone", "the fix"). | to record             |
| X post 3                                                                       | `docs/screenshots/07-alphabet-light.png`                                                                                                                         | exists                |
| X post 4                                                                       | `docs/screenshots/04-chat-light.png`                                                                                                                             | exists                |
| Product Hunt gallery 1–5                                                       | `distribution/screenshots/screenshot-01-home.png`, `-02-lessons.png`, `-07-alphabet.png`, `-08-roleplay.png`, plus the 15 s clip                                 | exists, plus the clip |
| Fallback GIF                                                                   | `docs/screenshots/tour.gif`                                                                                                                                      | exists                |

## Links (copy exactly)

Store links follow `AGENT-RULES.md`: Play carries `referrer=`, App Store
carries `pt=` and `ct=`. The provider token `128720195` is the one the
kensaur.us `/go/` redirector already uses (`kensaur.us` repo,
`src/go/main.ts:30`).

| Venue        | Web                                                                                                | Play                                                                                                                                                   | App Store                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| r/learnthai  | `https://kensaur.us/glot-it/?utm_source=reddit&utm_medium=post&utm_campaign=launch-2611-learnthai` | `https://play.google.com/store/apps/details?id=com.glotit.app&referrer=utm_source%3Dreddit%26utm_medium%3Dpost%26utm_campaign%3Dlaunch-2611-learnthai` | `https://apps.apple.com/app/id6761582648?pt=128720195&ct=launch-2611-learnthai` |
| X            | `https://kensaur.us/glot-it/?utm_source=x&utm_medium=post&utm_campaign=launch-2611-x`              | `https://play.google.com/store/apps/details?id=com.glotit.app&referrer=utm_source%3Dx%26utm_medium%3Dpost%26utm_campaign%3Dlaunch-2611-x`              | `https://apps.apple.com/app/id6761582648?pt=128720195&ct=launch-2611-x`         |
| Product Hunt | `https://kensaur.us/glot-it/?utm_source=producthunt&utm_medium=post&utm_campaign=launch-2611-ph`   | n/a                                                                                                                                                    | n/a                                                                             |

All three link shapes returned HTTP 200 on 2026-11-14.

## Check it worked

| When                | What to look at                                                                                                                                | Where                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 h after each post | Is it visible to others? Open `https://www.reddit.com/r/learnthai/new/` in a private window. Your post must be there with no "removed" banner. | browser, signed out                                                                                                                                                    |
| Day 1 and day 7     | Installs from the campaign                                                                                                                     | Play Console → Statistics → acquisition by UTM campaign `launch-2611-*`                                                                                                |
| Day 7               | iOS installs by campaign (Apple shows a campaign only at 5+ installs)                                                                          | App Store Connect → App Analytics → Sources → Campaigns                                                                                                                |
| Day 1 and day 7     | Web sessions on `kensaur.us/glot-it`                                                                                                           | Mushi Mushi console, glot.it project activity. UTM and referrer are **not** captured yet (audit 2026-11-14), so you see only the total spike, not which post caused it |
| Day 7               | New ratings                                                                                                                                    | Play Console → Ratings; App Store Connect → Ratings and Reviews                                                                                                        |

**Gate before this week starts:** the store badges must be visible at 390×844
without being covered by the sticky "Start free" bar (audit finding). Open
`kensaur.us/glot-it` on a phone, or ask the growth-glot lane whether its fix
is deployed. If it isn't, link the store pages directly and skip the web link.
