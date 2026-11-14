# yen-yen launch kit (week of 2026-11-30)

yen-yen is a kakeibo (家計簿) app for couples: four categories, receipts read by
AI, no bank login. Its listing already converts (Play, 28 days: 572
impressions → 24 visitors → 10 install clicks). The problem is reach, so this
week puts a **free tool** in front of people who budget and lets the app ride
along.

**Angle (JA):** 家計簿は費目を覚えるから続かない。4つに分けるだけなら続く。
**Angle (EN):** Budgets die in the categories. Kakeibo uses four.

The value-first asset is the free template, which works without the app:
`/ja/kakeibo/template` and `/kakeibo/template`. Each has a printable A4 sheet
and a CSV for Excel or Google Sheets. No sign-up, no email.

## Claims you may use

| Claim                                                                                  | Source                                                   | Checked    |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------- |
| Free template: A4 print sheet + CSV (BOM, opens in Excel without mojibake), no sign-up | live template pages                                      | 2026-11-14 |
| Kakeibo began in 1904 with the journalist 羽仁もと子 (Motoko Hani)                     | live template page; `docs/growth-plan-2026-11.md` L1 fix | 2026-11-14 |
| Four categories: 必要・欲しい・文化・想定外 (need, want, culture, unexpected)          | template page; app entry labels                          | 2026-11-14 |
| No bank or card login; manual entry, receipt scan, statement file import               | ja store listing; template page                          | 2026-11-14 |
| The personal kakeibo stays free; no ads                                                | ja full description                                      | 2026-11-14 |
| AI receipt reading: 30 a month free; Pro and Family 300                                | ja full description                                      | 2026-11-14 |
| Family plan: share one ledger with a partner; 7-day free trial on Pro and Family       | ja full description                                      | 2026-11-14 |
| Play JP: "10+ downloads", no rating; App Store JP: "Not enough ratings"                | live listings                                            | 2026-11-14 |

Do not use:

- **Founder Cohort.** It closed on 2026-11-13 at 34 households; no listing
  promises it any more (`docs/store-listing.md`).
- **"About 5 active households"** or any user count in public. It's an audit
  number, and it's small.
- Any line implying the owner and a partner use it to stop fighting. It may be
  true, but nobody has said so; the store copy talks about "households".

## Where its users are, with evidence

Reddit rules were read from `about/rules.json` on 2026-11-14 (see the glot.it
README for the method).

| Venue                     | Size         | Rule on your own app                                                                                                                         | Verdict                                                                                                                                        |
| ------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| note.com                  | n/a          | Own articles with links are normal; the owner already posts there                                                                            | **Post** (`01-note`), the main venue                                                                                                           |
| X (JP)                    | n/a          | normal X rules                                                                                                                               | **Post** (`02-x-ja`)                                                                                                                           |
| r/povertyfinance          | 2,960,825    | "Referral links, or links to your own content (whether monetized or not) are permitted. **You need to disclose if you have an affiliation**" | **Post** the free template (`03-reddit-povertyfinance`)                                                                                        |
| r/japanresidents          | 100,751      | "Generally all genuine posts are allowed (ragebait, spam, double posts on same day etc are not)"                                             | Optional: the JA/EN template as a resource, disclosed. Mods decide what "spam" is; a second post the same week reads as spam, so pick one week |
| r/budget                  | 177,925      | Affiliated products need disclosure; "Please use the megathread(s) for all discussions and recommendations of budgeting platforms/software"  | App only in the megathread. A method post about four categories is fine without the app link                                                   |
| r/JapanFinance            | 159,504      | "any content that looks like an advertisement will be removed"; "Don't cite LLMs"                                                            | **Comments only**, when someone asks how to track spending                                                                                     |
| r/japanlife               | 739,794      | Prohibited: "Self-promotion", "Links to blogs, videos, or social media"; posts need modmail approval for participation requests              | **Out**                                                                                                                                        |
| r/personalfinance         | 21,897,055   | Bans "Promotion of web content, products, services… owned by you… even if not monetized"                                                     | **Out**                                                                                                                                        |
| r/Frugal                  | 6,895,197    | "Self promotion of ANY KIND will get you permanently banned"                                                                                 | **Out**                                                                                                                                        |
| r/Marriage                | 1,033,910    | "No Commercial Interests"; no AI content "including modifying your own text for grammar or formatting"                                       | **Out**                                                                                                                                        |
| r/iOSapps                 | 131,010      | Budget trackers are a "saturated category": main feed needs 50+ ratings; account 90+ days and 300+ karma                                     | **Megathread only** ("App Shelf"), and disclose you're the developer                                                                           |
| r/Kakeibo                 | 25           | no rules listed                                                                                                                              | Too small to matter                                                                                                                            |
| Instagram 家計簿 accounts | not measured | normal IG rules                                                                                                                              | Worth trying: a 4-slide carousel of the four categories (media list below). Not drafted; reach unverified                                      |

## Posts in this folder

| File                                                                            | Venue               | When                                           |
| ------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------- |
| `rating-ask.ja.paste.md`, `rating-ask.en.paste.md` (rules: `../rating-asks.md`) | households you know | Mon 11-30                                      |
| `01-note.paste.md` + `.notes.md`                                                | note.com            | Tue 12-01, 20:00 JST                           |
| `02-x-ja.paste.md` + `.notes.md`                                                | X, Japanese         | Tue 12-01, 21:00 JST, linking the note article |
| `03-reddit-povertyfinance.paste.md` + `.notes.md`                               | r/povertyfinance    | Thu 12-03, 14:00 UTC (23:00 JST)               |

No Product Hunt for yen-yen. Its buyers and its best listing are Japanese, and
the English listing competes with every US budgeting app there.

## Media shot list

| Use                           | File (yen-yen repo, `origin/main`)                                                                                                                                                                    | Status     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| note header                   | **Make:** 1280×670 card of the four categories (必要・欲しい・文化・想定外) with the app's Kenji mascot from the existing OG image. No new mascot art (that belongs to the glot-it-ux-revamp session) | to make    |
| note body                     | the print sheet: open `/ja/kakeibo/template/print`, screenshot page 1                                                                                                                                 | to capture |
| note body                     | `docs/store-listing-assets/play/screenshots-ja/` (6 frames, guest sample household)                                                                                                                   | exists     |
| X post 1                      | the same four-category card                                                                                                                                                                           | to make    |
| r/povertyfinance              | a screenshot of the EN print sheet (`/kakeibo/template/print`) in a comment, if the sub allows images                                                                                                 | to capture |
| Instagram carousel (optional) | one slide per category with the example items from the template page                                                                                                                                  | to make    |

Never show a real ledger in any image (store-listing rule in `docs/store-listing.md`).

## Links (copy exactly)

| Venue                       | Link                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| note                        | `https://kensaur.us/yen-yen/ja/kakeibo/template?utm_source=note&utm_medium=post&utm_campaign=launch-2611-note`                              |
| X                           | `https://kensaur.us/yen-yen/ja/kakeibo/template?utm_source=x&utm_medium=post&utm_campaign=launch-2611-x`                                    |
| r/povertyfinance            | `https://kensaur.us/yen-yen/kakeibo/template?utm_source=reddit&utm_medium=post&utm_campaign=launch-2611-povertyfinance`                     |
| App, Play (note and X)      | `https://play.google.com/store/apps/details?id=app.yenyen&referrer=utm_source%3Dnote%26utm_medium%3Dpost%26utm_campaign%3Dlaunch-2611-note` |
| App, App Store (note and X) | `https://apps.apple.com/jp/app/id6764548441?pt=128720195&ct=launch-2611-note`                                                               |

## Check it worked

| When                      | What                                                                 | Where                                                               |
| ------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1 h after the Reddit post | visible signed out at `/r/povertyfinance/new/`, no removed banner    | private window                                                      |
| Day 1, day 7              | note views and likes                                                 | note dashboard                                                      |
| Day 1, day 7              | template downloads: the `template_download` event (`format`, `lang`) | kensaurus_events, the existing event from the 11-10 PR              |
| Day 7                     | installs by campaign `launch-2611-*`                                 | Play Console acquisition; App Store Connect campaigns (5+ installs) |
| Day 7                     | new ratings                                                          | both consoles                                                       |

**Gate before this week:** the web landing path. The audit found "Get the app"
→ `#download` → "Open on iPhone/Android" → a `/go/` JS interstitial, with a
noscript fallback to `/account/` instead of the store. Ask the growth-yy-hhtp
lane whether the one-tap static badges are deployed. The posts link the
template page, which has its own store buttons through `/go/`. If the
interstitial is still there, add the direct store links from the table above
in the note article.
