# Rating asks: rules and how to send them (never paste this file)

All five store apps have **0 public ratings** on both stores (Play and App
Store listings, checked 2026-11-14). The owner sends a short personal message
to people who already use each app. The texts are the `rating-ask.*.paste.md`
files in each app folder.

## The one rule: never offer anything for a review

No discount, credit, extra AI turns, free month, founder perk, raffle or
"thank-you gift", stated or implied. Both stores forbid it:

- **Google Play**, "User Ratings, Reviews, and Installs" policy
  (https://support.google.com/googleplay/android-developer/answer/9898684,
  read 2026-11-14): "We prohibit any manipulation of ratings, reviews, or
  install counts. This includes incentivizing feedback…", and "Don't offer
  rewards or incentives for ratings or reviews." Its own example of a
  violation: "This notification offers users a discount in exchange for a
  high rating."
- **Apple**, App Review Guidelines
  (https://developer.apple.com/app-store/review/guidelines/, read 2026-11-14):
  the introduction says apps that "manipulate ratings or App Store discovery"
  are removed and the developer expelled. **5.6.3 Discovery Fraud:**
  "Manipulating any element of the App Store customer experience such as
  charts, search, reviews, or referrals to your app erodes customer trust and
  is not permitted." **3.2.2 Unacceptable:** apps "must not force users to
  rate the app, review the app…" to unlock anything. **5.6.1 App Store
  Reviews:** in-app prompts must use Apple's API ("we will disallow custom
  review prompts"), which matters for the in-app prompt work, not for these
  personal messages.

Also:

- **Ask for an honest review, never for stars** or for a "positive" one. The
  texts say "honest".
- **yen-yen:** don't mention the Founder Cohort (closed 2026-11-13; those 34
  households keep Family free). Writing to them about reviews next to that
  perk reads as a trade.
- **Don't send to people who are not users**: no friends who never opened the
  app, no review swaps with other developers.
- **Never review your own apps** from any account.

## Who to send it to

| App                 | Who                                                                    | Where they are                                                        |
| ------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| glot.it             | learners who came back on 2 or more days                               | the people you already talk to: testers, friends, anyone who wrote in |
| yen-yen             | the households you know personally (about 5 are active, per the audit) | LINE or in person                                                     |
| help-her-take-photo | the couples who paired (2 active devices, per the audit)               | in person                                                             |
| the-wanting-mind    | readers who wrote to you, supporters                                   | email                                                                 |
| lets-talk           | testers and anyone who wrote in                                        | email, X DM                                                           |

Counts are from the growth audits of 2026-11-14. Send each person one message,
once. Don't follow up about the review; follow up about the app.

## How to send

1. Copy the paste file for the right language.
2. Add the person's name at the top. That's the only edit.
3. Send it from your own account: LINE, email, X DM or in person.
4. Note the date you sent it, so you don't send it twice.

## Direct review links (checked 2026-11-14, all HTTP 200)

| App                 | Play                                                                                               | App Store                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| glot.it             | `https://play.google.com/store/apps/details?id=com.glotit.app&showAllReviews=true`                 | `https://apps.apple.com/app/id6761582648?pt=128720195&ct=rating-ask-2611&action=write-review` |
| yen-yen             | `https://play.google.com/store/apps/details?id=app.yenyen&showAllReviews=true`                     | `https://apps.apple.com/app/id6764548441?pt=128720195&ct=rating-ask-2611&action=write-review` |
| help-her-take-photo | `https://play.google.com/store/apps/details?id=com.kensaurus.helphertakephoto&showAllReviews=true` | `https://apps.apple.com/app/id6762513666?pt=128720195&ct=rating-ask-2611&action=write-review` |
| the-wanting-mind    | `https://play.google.com/store/apps/details?id=us.kensaur.thewantingmind&showAllReviews=true`      | `https://apps.apple.com/app/id6761361305?pt=128720195&ct=rating-ask-2611&action=write-review` |
| lets-talk           | `https://play.google.com/store/apps/details?id=us.kensaur.howtotalktogirls&showAllReviews=true`    | `https://apps.apple.com/app/id6799392790?pt=128720195&ct=rating-ask-2611&action=write-review` |

Every App Store link carries `pt=128720195&ct=rating-ask-2611`, the store-link
standard, so these taps show up as their own campaign in App Store Connect
(Apple shows a campaign only at 5 or more installs). Re-checked 2026-11-14:
the link with `pt`, `ct` and `action=write-review` opens the right app page.

On a phone, the App Store link opens the app's page with the review sheet. The
Play link opens the reviews section; the person taps the stars there.

## Mushi Mushi

Mushi Mushi has no store app, so there is no rating ask. Don't ask anyone to
star the GitHub repo. It's the same kind of vote request HN and Product Hunt
penalize.

## Language notes

- The Thai text uses ครับ, the male polite ending. If you'd rather write as a
  woman, use ค่ะ (end of a statement) and คะ (end of a question). Have a Thai
  speaker read it once.
- The Japanese text uses です/ます and no honorific beyond that, which suits a
  message from the maker to someone they know.
