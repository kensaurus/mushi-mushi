# Tester-Marketplace Research for mushi-mushi (May 2026)

A pre-build research dossier for a public tester marketplace bolted onto mushi-mushi's developer-feedback-loop SaaS. Covers the mechanics, legal posture, and incentive design of the leading crowd-testing / bug-bounty / micro-task / loyalty platforms in 2026, with a final ranked recommendation for the cheapest-to-ship rewards model.

> Methodology: 12 parallel `firecrawl_search` queries plus targeted scrapes of the most authoritative pages. All claims are cited inline with URL + 1-line quote. Tax/legal claims are research summaries, **not legal advice** — engage counsel before launch.

---

## 1. Amazon Mechanical Turk (MTurk) — the reference architecture

MTurk's design is a 26-year-old answer to almost every question on this list, and most successor platforms are riffs on its choices.

**Reward model.** Workers earn cash bounties on tiny tasks ("HITs"). Requesters set the per-HIT reward, which Amazon takes a 20% cut of (40% for HITs with 10+ assignments, $0.01 minimum per assignment) ([MTurk Pricing](https://requestersandbox.mturk.com/pricing) — *"Tasks with 10 or more assignments will be charged an additional 20% fee on the reward you pay Workers. The minimum fee is $0.01 per assignment or bonus payment."*).

**Payout mechanics.** Workers transfer balance to a US bank account or an Amazon.com gift card on a 3/7/14/30-day schedule. New workers face a **10-day holding period** before any transfer ([MTurk Worker Help](https://www.mturk.com/worker/help) — *"Your rewards are held until you have been active on Amazon Mechanical Turk for at least 10 days, starting from the day you submit your first HIT."*). There is no fixed minimum payout dollar amount — but only one transfer per calendar day.

**Tax forms.** Tax info collection is **mandatory before working any HIT**, US or not (W-9 for US persons, W-8 for non-US) — *"We are required to collect this information before you work on HITs in the Mechanical Turk marketplace."* MTurk does not support U.S. citizens residing outside the U.S. at all. Reddit reports show MTurk switched to issuing **1099-NECs** for the 2024 tax year as the IRS threshold dropped from $20,000 → $5,000 → $2,500 → eventually $600 ([r/mturk 2024 1099 discussion](https://www.reddit.com/r/mturk/comments/1i6gi99/been_on_mturk_5_years_just_received_first_1099/) — *"Isn't the 1099 threshold 5000 for 2024 and 2500 for 2025?"*).

**Employer-of-record stance.** The MTurk Participation Agreement classifies workers as **independent contractors**, with Amazon as the marketplace operator only. Daily HIT caps and the prohibition on bots/scripts are explicit *"to combat conduct that would violate the Participation Agreement... ensuring that Workers are exercising their independent, human judgement."*

**International workers.** Non-US workers can receive Amazon.com gift cards; **eligible** countries (the list shifts) also get USD bank transfer via Hyperwallet, with the worker themselves picking a third-party FX provider. The "USD-only payouts to a non-US bank" architecture is critical — it lets Amazon avoid being a money transmitter in every country its workers live in.

**Qualification system.** Three tiers, all enforced server-side:

1. **HIT approval rate** + lifetime HITs completed (Requesters set thresholds).
2. **Masters Qualification** — algorithmic, "consistently demonstrated a high degree of success... across a large number of Requesters" ([MTurk Help](https://www.mturk.com/worker/help)). Cannot apply; can be revoked.
3. **Premium Qualifications** — workers self-declare via "Profile Information HITs" (age, country, profession, etc.) to access targeted work.

**Takeaway for mushi-mushi:** MTurk's three load-bearing decisions are (a) **collect tax forms before any earning event, not at $600** — eliminates the "we owe a 1099 but never collected a W-9" disaster; (b) **gift card as the universal fallback payout** — sidesteps both money-transmitter law and FX; (c) **algorithmic qualification tiers** so the dev side never has to manually approve testers.

---

## 2. UserTesting.com / Userlytics / Testbirds / Applause — paid usability platforms

These are *not* marketplaces in the MTurk sense; they're brokerage models where the platform sources both customers and a panel of vetted contractors.

**Earnings per session.**

- **UserTesting**: $4 for short (5-min) tests, $10 for unmoderated 20-min, $30–120 for moderated 60-min live conversations. A self-reported 30-day journal from one tester shows $553 / 53 tests = **~$10.40 average** ([r/usertesting 30-day review](https://www.reddit.com/r/usertesting/comments/xdm82d/detailed_review_of_my_first_30_days_on_usertesting/) — *"I earned a total of $553 and completed 53 tests in my first 30 days."*).
- **Userlytics** publishes ranges of "$5 to $90 per study" depending on type ([Userlytics paid tester](https://www.userlytics.com/user-experience-research/paid-ux-testing/)).
- **BetaTesting** disclosure: testers average **$10–$15 for 30-minute consumer tests, $15–$25 for 1 hour**, 2× for business professionals, $50–$150+ for moderated interviews ([BetaTesting Pricing](https://betatesting.com/pricing) FAQ — *"This is in contrast to other research platforms that think $1.50-$2.00 for a 10-minute test is actually enough to recruit quality participants."*).
- **uTest / Applause**: project-based; bug bounties range $5–$25 per defect, with hourly equivalents on ZipRecruiter clustering at $25–$64/hr ([Applause uTest WFH](https://www.applause.com/blog/work-from-home-with-utest/), [ZipRecruiter uTest jobs](https://www.ziprecruiter.com/Jobs/Utest)).

**Worker classification.** All four treat testers as **independent contractors** (W-9/1099 for U.S., W-8BEN for non-US). UserTesting's tester ToS describe testers as "platform participants" with no benefits, no W-2, no wage floor. This was reaffirmed in the May 2026 retreat from the DOL's 2024 IC rule — the agency announced it will **no longer enforce** the six-factor totality-of-circumstances test that briefly threatened gig classification ([Ford Harrison](https://www.fordharrison.com/us-department-of-labor-announces-it-will-no-longer-enforce-2024-independent-contractor-rule) — *"The 2024 rule defined 'independent contractor' under the FLSA and set forth a six-factor test."*; [Jackson Lewis on the 2026 proposed rule](https://www.jacksonlewis.com/insights/dols-proposed-2026-independent-contractor-rule-what-employers-need-know)).

**Fraud prevention.** Three layers in production today:

1. **Mandatory screen + webcam recording** during each test session.
2. **Microphone calibration / voice continuity check** to flag the same person running multiple accounts.
3. **AI-scored quality grading** per submission. BetaTesting confirms an in-house "automated AI scoring per-tester, in addition to manual ratings from our customers and customer success team."

Mature platforms increasingly add **biometric onboarding with liveness detection** — selfie + government ID matched against the screen-record's webcam frame ([Sumsub biometric verification](https://sumsub.com/biometric-verification/), [Plaid selfie ID](https://plaid.com/resources/identity/selfie-id-verification/)). Veriff's 2026 fraud trends report flags emulators and impersonation as the dominant attack vectors ([Veriff 2026 trends](https://www.biometricupdate.com/202512/impersonation-emulators-and-ecommerce-lead-sophisticated-fraud-trends-veriff)).

**Takeaway for mushi-mushi:** The mature playbook is **W-9/W-8 at signup, contractor status, screen+webcam recording, AI scoring** — not "trust + cash out". UserTesting's *median* tester payout is also a useful price floor for any session of meaningful length.

---

## 3. HackerOne / Bugcrowd / Intigriti — bug bounty

**Payout methods.** HackerOne pays via **bank transfer, PayPal, or direct-to-wallet crypto (BTC/USDC)** — but only after the researcher has set up a payout method *and* filed a tax form ([HackerOne Receiving Payments](https://docs.hackerone.com/en/articles/8395706-receiving-payments) — *"HackerOne will ask to collect your tax form before processing the payout."*; [HackerOne Tax Forms](https://docs.hackerone.com/en/articles/8395744-tax-forms)). Bugcrowd uses the same gate ([Bugcrowd W-8BEN](https://docs.bugcrowd.com/researchers/payments/setting-up-payment-methods/submitting-tax-form-for-non-us-person-individual/) — *"If you are not a US person and an individual, then you must submit the W-8BEN substitute tax form to receive payouts."*).

**Triage workflow.** Three parties:

1. **Hacker** submits report.
2. **Triage team** (HackerOne's own analysts, or the program's internal team) assigns initial validity / severity.
3. **Program owner** (the customer paying) makes the final award.

The platform mediates disputes ("Hacker Mediation"), but **only the program decides validity** — HackerOne is not the buyer or the employer, just the marketplace.

**Tax handling.** HackerOne and Bugcrowd collect W-9 (US) or W-8BEN (non-US) **before** the first bounty disbursement. They issue 1099-MISCs at year-end for US researchers crossing $600 (or whatever the prevailing threshold is). Charitable donation is supported as a 1099-bypass — a researcher can route the bounty straight to a charity ([HackerOne Receiving Payments](https://docs.hackerone.com/en/articles/8395706-receiving-payments) — *"You can choose to donate your bounties in full, or you can choose to donate a part of your bounty."*).

**Reputation / tier system.** HackerOne publishes an explicit formula ([HackerOne Reputation](https://docs.hackerone.com/en/articles/8369865-reputation)):

| Event | Δ reputation |
|---|---|
| Triaged or Resolved | +7 |
| Duplicate of pre-publication resolved | +2 |
| Informative / Self-closed N/A | 0 |
| Not Applicable / Duplicate of N/A | −5 |
| Spam | −10 |
| Bounty ≥ μ + 1 σ ("BOUNTY_SEVERE") | +50 |
| Bounty > μ | +25 |
| Bounty ≥ μ − 1 σ | +15 |

> *"Maintaining a high reputation unlocks additional privileges, including eligibility for private bug bounty invitations. When your reputation drops, the system limits how many reports you can submit over a set period."*

**Takeaway for mushi-mushi:** The signal-to-noise problem on bug bounty is identical to feedback testing: most "bug reports" are duplicates or non-issues, and the platform exists to grade reports before forwarding them to the developer. HackerOne's reputation curve (positive on resolution, negative on noise, sigma-weighted by bounty magnitude) is the most polished signal-management system on the internet — worth porting wholesale.

---

## 4. Google Opinion Rewards / Microsoft Rewards / Bing Rewards — points-as-coupon

**Classification.** All three issue **points redeemable only for in-platform value** (Google Play credit / Xbox Game Pass / Microsoft Store / sweepstakes entries / Amazon gift cards via the Bing arm). The IRS has **not** specifically ruled on whether rewards-program points earned from non-purchase activities (search, survey, etc.) are taxable; the relevant guidance dates to the Anikeev v. Commissioner concession ([Fordham Law on rewards taxability](https://news.law.fordham.edu/jcfl/2017/09/27/do-rewards-points-classify-as-taxable-income/) — *"The IRS has yet to decide whether rewards points earned just for signing up are considered 'income' for federal income tax purposes."*; [Tax Adviser](https://www.thetaxadviser.com/issues/2018/aug/receipt-redemption-rewards-program-points/)).

**Practical posture today.** Forbes summarizes the consensus: points earned **as a discount on a purchase** (cashback, credit-card miles) are a rebate, not income, and not taxable ([Forbes Advisor](https://www.forbes.com/advisor/credit-cards/are-credit-card-rewards-taxable/) — *"most points and miles you earn aren't considered income by the IRS, which means they aren't taxable."*). Points earned **for performing a service** (search, survey, opinion) are income at fair market value at redemption — but the consensus tax-advice answer is that they're reportable income at FMV on redemption ([Money StackExchange](https://money.stackexchange.com/questions/34076/are-search-engine-rewards-taxable) — *"Short answer: Yes. You have to report these benefits as income, whether you opt for gift cards or anything else."*).

**Why the platforms avoid 1099s anyway.** Two structural reasons:

1. **Per-redemption value is tiny**, and the platforms cap the annual aggregate well below $600. Microsoft Rewards limits redemption velocity and never aggregates a single user past the threshold without manual review.
2. **Redemptions for the company's own products** (Google Play credit, Xbox Game Pass) are structured as **promotional discounts** rather than payments — a coupon, not consideration.

**Takeaway for mushi-mushi:** Points that redeem **only inside your own product** (mushi-mushi Pro tier, extra API calls, more app slots) get the same tax treatment as a coupon — the redeemer doesn't have a 1099-reportable event because no money or third-party FMV ever changes hands. This is by far the cleanest legal posture.

---

## 5. Web3 / token rewards — the cautionary section

**State in 2026.** The blockchain-reward thesis has lost most of its champions:

- **Reddit Community Points** (an ERC-20 system that rewarded subreddit contributions) was sunset on Nov 8, 2023: *"The regulatory environment has added to scalability limitations… the product is no longer set up to scale"* ([The Block](https://www.theblock.co/post/258016/reddit-plans-to-sunset-its-blockchain-based-reward-service-community-points)). Reddit explicitly cited "a tough regulatory environment for cryptocurrency projects" as the cause.
- **Brave's BAT** survived but is now in "Rewards 3.0" rebuild, with payout regions shrinking to those the Uphold/ZebPay/bitFlyer/Gemini KYC stack can support ([Brave supported regions](https://support.brave.app/hc/en-us/articles/6539887971469-List-of-supported-regions-Payout-accounts)). A 2025 community post described BAT as "transitioning" rather than thriving ([r/BATProject](https://www.reddit.com/r/BATProject/comments/1o39psm/bat_is_a_failed_project_change_my_mind/) — *"BAT isn't a failed project, but is transitioning with Brave Rewards 3.0 set for early 2025."*).
- **Layer3 / Galxe / Rabbithole** style "quest" platforms have repeatedly pivoted away from native-token rewards toward USDC payouts and platform XP that exists off-chain, citing the same regulatory pressure.

**Regulatory framing.**

1. **Securities law (Howey).** Any token that "moves with" the platform's success is at risk of being classified as an investment contract. The SEC's 2020–2024 enforcement campaign against unregistered token offerings made this an existential risk for small startups.
2. **Money transmitter law.** Issuing a token redeemable for cash potentially triggers state-level money transmitter licensing in 49+ U.S. states (~$10–250 K each, multi-year processes). Closed-loop value (only redeemable for one company's own products) is typically exempt; open-loop, multi-merchant value is not.
3. **IRS Notice 2014-21.** Treats virtual currency as **property**, not currency — meaning every reward issuance creates a basis event, and every redemption is a capital gain/loss event for the user, plus a 1099 for the platform if FMV > $600 ([IRS Notice 2014-21](https://www.irs.gov/pub/irs-drop/n-14-21.pdf), [IRS Digital Assets](https://www.irs.gov/filing/digital-assets)).
4. **Crypto regulatory landscape 2025 → 2026.** Chainalysis's 2025 round-up describes a mostly tightening global posture, with the U.S. only recently softening on certain enforcement priorities ([Chainalysis 2025 round-up](https://www.chainalysis.com/blog/2025-crypto-regulatory-round-up/)).

**Takeaway for mushi-mushi:** Token rewards are a **dominated strategy** for a small startup. Higher legal complexity, higher engineering cost (wallet UX, payout rails, custody), worse tax outcome (every redemption is a basis event), and the precedent of larger players (Reddit) pulling out of the same model. Hard no, except as a far-future option once gross merchandise volume could fund a full money-transmitter rollout.

---

## 6. Gift card / cashback — Swagbucks, InboxDollars, Rakuten

**The $600 threshold is a hard line.** Swagbucks publishes the cleanest example:

> *"Upon reaching $600 or more in SB redemptions in one calendar year, you will be prompted to fill out the required tax information about yourself. You will not be allowed to continue redemptions (except for PayPal and Gambit) for the rest of the calendar year until you successfully complete the tax form."* ([Swagbucks Taxes](https://help.swagbucks.com/hc/en-us/articles/360049700471-Taxes))

Critically, Swagbucks **classifies which activities count toward the $600 threshold**:

| Counts toward $600 | Does NOT count |
|---|---|
| Registration / Promo / Referral | Gambit (sweepstakes) |
| Search | Discover / Offers |
| Surveys, Tasks, Receipts | Shopping (cashback rebate) |
| Games (non-GSN) | GSN |
| SB Live | In-Store Deals |

The split is exactly the tax-doctrine one in §4: cashback on a purchase is a **rebate** (not income), but completing a survey is **payment for services** (income).

**"Merchandise vs cash" is not a meaningful 1099-MISC distinction.** IRS Form 1099-MISC explicitly requires reporting **"prizes and awards"** at fair market value — *"If the fair market value (FMV) of a prize or award is $600 or more in a calendar year, you may need to issue a Form 1099-MISC to the recipient."* ([1099fire on prizes](https://www.1099fire.com/blog/handling-1099-reporting-for-prizes-awards-and-promotional-giveaways/); [IRS Form 1099-MISC](https://www.irs.gov/forms-pubs/about-form-1099-misc) — *"At least $600 in… prizes, awards or other income payments"*). Giving an Apple Pencil instead of $129 does not avoid the 1099 — the FMV of the merchandise is what counts.

**The platforms default to gift cards because of payment-rail simplicity, not tax avoidance.** Gift cards are closed-loop value, do not trigger money-transmitter scrutiny, and let the platform monetize "breakage" (unredeemed value). Giftbit and Tango both share breakage back to the sender; Tremendous does not publish a number ([Giftbit vs Tremendous vs Tango](https://www.giftbit.com/tremendous-tango-alternatives) — *"25% of unclaimed value goes back to sender as default"* on Giftbit, *"75% breakage sharing"* on Tango).

**Takeaway for mushi-mushi:** Gift cards are a **payment-rail decision**, not a tax-avoidance one. Once a US user crosses $600 of taxable redemptions in a calendar year, a 1099 is required regardless of whether the payment is cash, an Amazon gift card, or an AirPods set.

---

## 7. Sweepstakes / prize draws — top-N drawings

**Three-element test.** Olshan's Sweepstakes Law Basics is the canonical short form ([Olshan](https://www.olshanlaw.com/sweepstakes-law-basics)):

> *"A sweepstakes is a promotion in which a prize is awarded on the basis of chance rather than skill. If a prize is awarded on the basis of skill the promotion is considered a contest."*

> *"Generally, a lottery is a promotion in which all three of the following elements are present: 1) prize; 2) chance; and 3) consideration."*

To stay legal as a private sweepstakes (not an illegal lottery), the operator must **remove consideration** — entry cannot be conditioned on payment, purchase, or substantial time/effort.

> *"Non-monetary consideration is an entrant's expenditure of considerable time or effort."*

This is the load-bearing constraint for mushi-mushi: requiring a full test session in exchange for an entry **probably constitutes non-monetary consideration**, and a sweepstakes structure with that requirement could be re-characterized as an illegal lottery in most U.S. states ([Holland & Knight](https://www.hklaw.com/en/insights/publications/2022/05/marketers-beware-your-social-media-sweepstakes-or-contests-could-be) — *"States usually define lotteries as having three elements: 1) a prize, 2) chance and 3) consideration."*).

**Registration & bonding.** Florida, New York, Rhode Island require **registration + a bond equal to the total prize value** for sweepstakes with prizes > $5,000 (>$500 in RI for retail) ([Olshan](https://www.olshanlaw.com/sweepstakes-law-basics)). Record retention is 4 years.

**Does a sweepstakes avoid 1099?** No. The IRS treats prizes ≥ $600 FMV as reportable on 1099-MISC regardless of the chance/skill split ([IRS Form 1099-MISC](https://www.irs.gov/forms-pubs/about-form-1099-misc)). The legal characterization matters for **gambling law**, not income tax.

**Examples in practice.** Game studios (Roblox, Riot, Activision) routinely run "complete X drills, top-N entries by RNG win the merch" structures with an **AMOE (Alternative Method of Entry)** — a free entry path via mail-in postcard — preserving sweepstakes status. Discord's Nitro Boosts and similar boost-the-server prizes are tier perks (not sweepstakes) — they reward purchase, not chance.

**Takeaway for mushi-mushi:** A monthly drawing among "testers who submitted ≥ N quality bug reports this month" is **legally risky** without a free AMOE path, because session completion is non-monetary consideration. With a free AMOE path the structure is legal, but the 1099 question remains for winners crossing $600 FMV.

---

## 8. Points-as-platform-credits — the cleanest model

**Examples that work.**

- **Stack Overflow reputation** — non-cash, non-transferable, unlocks platform privileges (vote, edit, moderate). Never been challenged by a tax authority because no value ever leaves the platform.
- **Roblox DevEx** is the *interesting* counter-example. Robux earned in-platform are convertible to USD via the Tipalti-backed DevEx program — *but only* above a $10,000 Robux ($35.94+ USD) cash-out floor, with the platform doing W-9/W-8BEN collection **at conversion**, not at issuance ([Roblox DevEx ToS](https://en.help.roblox.com/hc/en-us/articles/115005718246-Developer-Exchange-Terms-of-Use); [Roblox Tipalti tax portal](https://en.help.roblox.com/hc/en-us/articles/27985018895124-Tax-and-DevEx-Portal-Tipalti-Information); [Roblox developer taxes 2026 guide](https://www.monacocpa.cpa/post/roblox-developer-taxes-devex-guide)). Until cash-out, Robux are "platform currency" with no IRS event.
- **GitHub Sponsors** is *not* a credits system — it's straight cash, with full 1099-NEC reporting on US recipients earning > $600. Don't model on this.
- **Steam Workshop earnings** (community content creators) work like DevEx — Steam Wallet credit (non-taxable, closed-loop) is the default, with cash conversion gated by tax-form collection.

**Why this avoids 1099.** Two doctrines:

1. **No "amount paid" without an arm's-length value.** Closed-loop credits redeemable only for the issuer's own products are economically equivalent to a coupon. The IRS treats issuer-funded discounts as price adjustments, not income.
2. **No fair market value to report.** A credit good only for "more mushi-mushi API calls" has no FMV in any liquid market — there is no exchange rate to USD.

**The instant something becomes convertible to USD or to a third-party gift card, the tax analysis flips.** The Roblox DevEx pattern is the safe-harbor: keep credits in-platform forever for most users; gate the *option* to convert behind tax-form collection.

**Takeaway for mushi-mushi:** Build the rewards on a **"mushi-bucks"** model that redeems only for mushi-mushi Pro features (more apps, more API quota, faster build minutes, priority support). Optionally bolt on a Roblox-style "DevEx" cash-out at a high floor (say $100) with mandatory tax-form collection — but ship without it.

---

## 9. Identity / KYC for testers — when does verification kick in

Layered approach across the major platforms:

| Platform | At signup | At first earning | Before payout / cash-out | Why |
|---|---|---|---|---|
| MTurk | Email + Amazon account | **W-9 / W-8** + identity verification (automated, "a few minutes") | Bank account confirmation | Tax law + employer-of-record stance |
| UserTesting | Email + voice/webcam sample test | Profile screener (~5 min) | PayPal / direct deposit confirmation | Fraud control |
| BetaTesting | Email + screener | Phone + screen recording on tests | Gift card delivery email | Lower friction (sub-$600 typical) |
| HackerOne / Bugcrowd | Email | n/a (no upfront work paid) | **W-9 / W-8** + payout method | Tax form gates payout ([HackerOne Tax Forms](https://docs.hackerone.com/en/articles/8395744-tax-forms)) |
| Swagbucks | Email | nothing | **W-9 + 1099** at $600/yr taxable redemptions | IRS threshold ([Swagbucks Taxes](https://help.swagbucks.com/hc/en-us/articles/360049700471-Taxes)) |
| Tremendous (sender side) | Account setup | n/a | **W-9 at $2,000 cumulative + TIN validation** ([Giftogram on W-9](https://giftogram.com/blog/w-9-collection-1099-compliance-for-digital-gift-card-rewards-made-easy-with-giftogram)) | Pre-1099 catch-up |
| Brave Rewards | Browser install | nothing | **Uphold/ZebPay/bitFlyer KYC** (gov ID + selfie) | Crypto custody KYC ([Brave supported regions](https://support.brave.app/hc/en-us/articles/6539887971469-List-of-supported-regions-Payout-accounts)) |

The pattern: **verify identity proportional to the cash value at stake**. Email-only is fine for free-tier testing; KYC kicks in at payout — and tax-form collection (W-9 / W-8) is *also* the de-facto KYC for any payment over a few hundred dollars.

**Sumsub / Plaid / Au10tix / Veriff** all offer one-shot selfie+ID flows that complete in <60 seconds and cost ~$1-3 per verification at the small-startup tier ([Sumsub](https://sumsub.com/biometric-verification/), [Plaid selfie ID](https://plaid.com/resources/identity/selfie-id-verification/)). Mature platforms increasingly mandate this at the first payout *and* on every device change.

---

## 10. Anti-fraud detection

The state of the art combines four signal layers:

1. **Device fingerprint.** Browser canvas, audio context, WebGL, font enumeration, hardware concurrency — distilled to a stable hash. Lets one user be reliably tracked across "fresh" accounts.
2. **IP / network signals.** Datacenter IP detection, residential-proxy detection, ASN reputation, GeoIP mismatch with declared country.
3. **Behavioral signals.** Mouse path entropy, typing rhythm, time-on-task vs. submitted answer quality. BetaTesting confirms in-house *"AI analysis of feedback and automated scoring per-tester"*.
4. **Liveness biometrics.** Selfie + 3D face geometry, blink/expression challenges, sometimes a one-time webcam recording matched against the screen-record's frame. Veriff's 2026 trends report — *"impersonation, emulators and ecommerce lead sophisticated fraud trends"* ([Veriff 2026](https://www.biometricupdate.com/202512/impersonation-emulators-and-ecommerce-lead-sophisticated-fraud-trends-veriff)) — confirms that even basic liveness checks cut bot/sockpuppet rates by an order of magnitude.

UserTesting/Userlytics require a **mandatory webcam-on session recording** for every paid test — this is both a deliverable (the client buys the recording) and the primary fraud control: an account submitting AI-narrated screen recordings instead of a real face gets flagged within a few sessions.

For mushi-mushi, the minimum viable fraud stack is:

- Device fingerprint hash on signup (one-line FingerprintJS) → dedupe accounts.
- IP + ASN check on each payout request → block VPNs and known fraud netblocks.
- Webcam + mic recording **only** during paid sessions (not for free credits).
- Liveness selfie on first payout > $20 equivalent.

---

## 11. Crowd-testing-as-a-service for devs — the competitive landscape

**Free / dev-tier tools that exist today.**

- **Apple TestFlight** — free, Apple-managed, capped at 10,000 external testers per build, no paid pool, identity = Apple ID only.
- **Expo EAS Update** (`--branch preview`) — dev-tier internal builds, no paid pool, identity = the dev's own users.
- **Firebase App Distribution** — free, similar to TestFlight, no paid pool.
- **Google Play Internal / Closed Testing** — same.

**The gap.** None of the four offer a **paid public-tester pool**. The dev has to source testers themselves (subreddits, Discord, friends-of-friends).

**Paid public-tester platforms that exist.**

- **BetaTesting.com** — credits-based, $23–$39 per credit, ~$30 per 30-min consumer test. **Tester incentive is *included* in the credit price** — the dev doesn't separately fund the tester pool. Project plans run from a few hundred dollars; subscription tier at $1,250/mo for 50 credits (~38–50 testers/month) ([BetaTesting Pricing](https://betatesting.com/pricing) — *"Every test includes participant recruiting with no additional fees (incentive already included)."*).
- **PlayTestCloud** (gaming) — similar credit model, tilted toward mobile games.
- **uTest / Applause** — enterprise sales, paid testers, but unsuited to indie devs (minimum spends in the tens of thousands).
- **TestFairy / Lookback** — *unmoderated test* tooling, no tester pool.

**Fee structure summary.**

| Platform | Tester pool | Pricing model | Indie-dev fit |
|---|---|---|---|
| BetaTesting | 450K panel | $23–$39/credit, 1 credit ≈ 1 tester | ✅ |
| Userlytics | ~3M panel | ~$70-160 per moderated session, ~$10-25 unmoderated | partial |
| UserTesting | proprietary | $25K+/yr enterprise | ❌ |
| Applause | enterprise | $50K+/yr | ❌ |
| TestFlight + DIY | none | free | DIY |

The gap is real: **no platform offers a $10-50/month tier with a dozen paid testers**. This is mushi-mushi's wedge.

---

## 12. Country-specific tax / regulatory landmines

A short list of failure modes and the corresponding safe harbors:

| Risk | What triggers it | Safe harbor |
|---|---|---|
| **Misclassified employer** | Setting tester hours, mandating uniforms / training, "ratings" that affect future wages | Independent-contractor agreement in ToS; no schedules; no mandatory training; **leave the DOL six-factor test in place even though 2026 enforcement is lax** ([DOL rulemaking](https://www.dol.gov/agencies/whd/flsa/misclassification/rulemaking)). |
| **Money transmitter** | Issuing redeemable value across multiple unaffiliated merchants, or USD-out for non-purchase activity | **Closed-loop platform credits only**; outsource any third-party gift-card payout to **Tango / Tremendous / Giftbit** (they hold the MTLs — Tango holds Money Transmitter Licenses in "most US states" per [Giftbit comparison](https://www.giftbit.com/tremendous-tango-alternatives)). |
| **1099-MISC for prizes** | Aggregate redemptions ≥ $600/yr FMV | **Cap payouts at $599/yr** OR **collect W-9 at signup** OR **route through Tango/Tremendous tax-1099 export**. ([Tremendous W-9 collection](https://www.tremendous.com/) — automated W-9 at redemption, TIN validation against IRS records, 1099-NEC/MISC export via Tax1099). |
| **Securities law** | Tokens that "move with platform success" | Don't issue tokens. If you must, use a stablecoin-USDC payout (no security). |
| **Illegal lottery / gambling** | Prize draw + chance + consideration | **Free AMOE path** (mail-in entry) for every prize draw, OR contest of pure skill with qualified judges. ([Olshan](https://www.olshanlaw.com/sweepstakes-law-basics) — *"A legitimate sweepstakes typically removes the consideration element."*) |
| **State sweepstakes registration** | Prizes > $5K (FL, NY), > $500 (RI retail) | Cap monthly prize value < $5,000 OR register + bond. |
| **GDPR / CCPA on tester PII** | Storing biometric data, webcam recordings | Webcam recording = explicit opt-in per session; auto-delete recordings after dev review window (e.g. 30 days). |
| **State sales tax on credits** | Selling "mushi-bucks" packs for cash without tax | Treat credit purchase as a deposit, not a sale; defer recognition until redemption. |
| **VAT in EU / GST in UK / AU** | Selling credits or rewards into VAT jurisdictions | Use a Merchant-of-Record (Paddle, Lemon Squeezy) for credit sales. |

**The minimum-viable startup posture:**

1. **Use Tango Card / Tremendous / Giftbit as the payout vendor** so they hold the money-transmitter licenses, file 1099-NECs, and collect W-9s at $2,000 cumulative ([Giftogram W-9 collection](https://giftogram.com/blog/w-9-collection-1099-compliance-for-digital-gift-card-rewards-made-easy-with-giftogram) — *"We'll prompt recipients to fill out a W-9 form once they've received $2,000 in digital gift card rewards or payouts."*).
2. **Default to in-platform credits**; gate any third-party cash-out behind W-9 + identity verification.
3. **Cap individual annual third-party-cash-equivalent payouts at $599** in v1; raise after tax infrastructure is built.
4. **Mandatory AMOE on any prize draw**; cap aggregate prize value < $5K to avoid FL/NY/RI registration.
5. **Geofence US-only at v1** — non-US-only could work too, but mixing both means dual tax stacks. US is where the customers (the dev side) are.

---

## Synthesis: ranked rewards models for mushi-mushi

Each option scored 1–5 on four axes (1 = best for that row, 5 = worst):

- **Legal risk** (1 = trivially safe, 5 = needs a securities lawyer)
- **Engineering complexity** (1 = a weekend, 5 = a quarter)
- **Perceived tester value** (5 = "I really want this", 1 = "meh")
- **Nudge-to-pay-for-mushi-pro** (5 = strongest funnel, 1 = none)

| Option | Legal risk | Eng complexity | Tester value | Pro-nudge | **Net score** |
|---|---|---|---|---|---|
| **(a) Platform credits ("mushi-bucks")** | **1** | **2** | 3 | **5** | **strongest** |
| (b) Tango / Tremendous gift cards (sub-$600 cap) | 2 | 2 | 5 | 2 | strong |
| (c) Monthly prize draws (top-N) | 3 | 3 | 4 | 3 | medium |
| (e) Sweepstakes with merch | 4 | 4 | 4 | 2 | weak |
| (d) Crypto / web3 tokens | 5 | 5 | 2 | 1 | **avoid** |

### Recommendation: **launch with (a) + (b) in parallel; defer (c)–(e)**

**v1 (week 1–2): "mushi-bucks" platform credits only.**

- 1 tested-and-approved bug report = 100 mushi-bucks.
- 1 mushi-pro month = 1,000 mushi-bucks.
- 1 additional published app slot = 2,500 mushi-bucks.
- 1 month of extra API quota = 500 mushi-bucks.

This ships in days. Legal risk: ~zero (closed-loop platform credits, no FMV, no third-party value). It is also the strongest funnel into mushi-pro — every reward redemption makes the tester more dependent on the platform.

**v1.5 (week 3–6): bolt on a Tango / Tremendous cash-out path at a high floor.**

- Once a tester accumulates ≥ 5,000 mushi-bucks (≈ $50 face value), unlock "Cash Out via Tango Reward Link."
- Tango/Tremendous handles W-9 collection, TIN validation, money-transmitter licensing, and IRS 1099 export.
- Per-user lifetime cash-out cap at $599 in v1.5; raise to $1,999 (Tango's W-9 trigger) only after the tax pipeline is wired.
- This adds ~2 weeks of engineering: account creation in Tango, API integration, webhook on redemption, and a payout-status table.

**v2 (post-launch): selectively add (c) Monthly prize draws.**

- "Top 10 testers this month win an Apple Pencil." With a **mandatory free AMOE path** ("mail us a postcard to enter for free").
- Cap aggregate prize value < $5,000 to avoid FL/NY/RI registration.
- File 1099-MISC for any individual winner crossing $600 FMV/year (combined with their cash-out total).

**Explicitly do NOT ship:**

- (d) Crypto/token rewards. Securities, money transmitter, and IRS-Notice-2014-21 risk all compound. Reddit's sunset is the case study; Brave's region shrinkage is the second one.
- (e) Pure sweepstakes with merch as the *primary* model. The non-monetary-consideration problem means a paid test-completion gate is structurally a lottery in most U.S. states.

### What this looks like in mushi-mushi's stack

Three new Supabase tables (per the [AGENTS.md](../../AGENTS.md) Supabase MCP conventions):

```sql
-- migration 003XX_tester_rewards_schema.sql
create table public.tester_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  tester_id uuid references auth.users not null,
  delta_credits integer not null, -- positive = earned, negative = redeemed
  source text not null check (source in (
    'bug_report_approved', 'test_session_completed',
    'pro_redemption', 'app_slot_redemption', 'api_quota_redemption',
    'tango_cashout', 'admin_adjustment'
  )),
  metadata jsonb default '{}'::jsonb,
  project_id uuid references public.projects,
  created_at timestamptz default now()
);

create table public.tester_payouts (
  id uuid primary key default gen_random_uuid(),
  tester_id uuid references auth.users not null,
  amount_usd_cents integer not null,
  tango_order_id text,
  tango_status text,
  w9_collected_at timestamptz,
  ytd_payout_usd_cents integer not null,
  created_at timestamptz default now()
);

create table public.tester_kyc (
  tester_id uuid primary key references auth.users,
  fingerprint_hash text,
  selfie_verified_at timestamptz,
  w9_filed_at timestamptz,
  ssn_hash text,        -- last 4 only, hashed
  country_code text,
  banned_at timestamptz,
  ban_reason text
);
```

A new edge function `tango-cashout-worker` (per the agent-inventory pattern in [AGENTS.md](../../AGENTS.md)) calls Tango RaaS, writes the order ID back, and verifies status on a 5-minute cron. KYC lives behind a feature flag — off by default in v1, on at the first cash-out request.

This gives mushi-mushi the strongest leverage point in the developer-feedback-loop SaaS category: **the only paid tester pool that's free for the dev to access at the credit tier**, with a clean cash-out path for any tester who wants real value.

---

## Citation index (24 URLs)

1. https://requestersandbox.mturk.com/pricing
2. https://www.mturk.com/worker/help
3. https://www.reddit.com/r/mturk/comments/1i6gi99/been_on_mturk_5_years_just_received_first_1099/
4. https://www.reddit.com/r/usertesting/comments/xdm82d/detailed_review_of_my_first_30_days_on_usertesting/
5. https://www.userlytics.com/user-experience-research/paid-ux-testing/
6. https://www.applause.com/blog/work-from-home-with-utest/
7. https://www.ziprecruiter.com/Jobs/Utest
8. https://betatesting.com/pricing
9. https://docs.hackerone.com/en/articles/8395706-receiving-payments
10. https://docs.hackerone.com/en/articles/8369865-reputation
11. https://docs.hackerone.com/en/articles/8395744-tax-forms
12. https://docs.bugcrowd.com/researchers/payments/setting-up-payment-methods/submitting-tax-form-for-non-us-person-individual/
13. https://news.law.fordham.edu/jcfl/2017/09/27/do-rewards-points-classify-as-taxable-income/
14. https://www.thetaxadviser.com/issues/2018/aug/receipt-redemption-rewards-program-points/
15. https://www.forbes.com/advisor/credit-cards/are-credit-card-rewards-taxable/
16. https://money.stackexchange.com/questions/34076/are-search-engine-rewards-taxable
17. https://www.theblock.co/post/258016/reddit-plans-to-sunset-its-blockchain-based-reward-service-community-points
18. https://www.reddit.com/r/BATProject/comments/1o39psm/bat_is_a_failed_project_change_my_mind/
19. https://support.brave.app/hc/en-us/articles/6539887971469-List-of-supported-regions-Payout-accounts
20. https://www.chainalysis.com/blog/2025-crypto-regulatory-round-up/
21. https://www.irs.gov/pub/irs-drop/n-14-21.pdf
22. https://www.irs.gov/filing/digital-assets
23. https://help.swagbucks.com/hc/en-us/articles/360049700471-Taxes
24. https://www.irs.gov/forms-pubs/about-form-1099-misc
25. https://www.1099fire.com/blog/handling-1099-reporting-for-prizes-awards-and-promotional-giveaways/
26. https://www.olshanlaw.com/sweepstakes-law-basics
27. https://www.hklaw.com/en/insights/publications/2022/05/marketers-beware-your-social-media-sweepstakes-or-contests-could-be
28. https://en.help.roblox.com/hc/en-us/articles/115005718246-Developer-Exchange-Terms-of-Use
29. https://en.help.roblox.com/hc/en-us/articles/27985018895124-Tax-and-DevEx-Portal-Tipalti-Information
30. https://www.monacocpa.cpa/post/roblox-developer-taxes-devex-guide
31. https://www.giftbit.com/tremendous-tango-alternatives
32. https://www.tangocard.com/gift-card-api
33. https://www.tremendous.com/
34. https://giftogram.com/blog/w-9-collection-1099-compliance-for-digital-gift-card-rewards-made-easy-with-giftogram
35. https://sumsub.com/biometric-verification/
36. https://plaid.com/resources/identity/selfie-id-verification/
37. https://www.biometricupdate.com/202512/impersonation-emulators-and-ecommerce-lead-sophisticated-fraud-trends-veriff
38. https://www.dol.gov/agencies/whd/flsa/misclassification/rulemaking
39. https://www.fordharrison.com/us-department-of-labor-announces-it-will-no-longer-enforce-2024-independent-contractor-rule
40. https://www.jacksonlewis.com/insights/dols-proposed-2026-independent-contractor-rule-what-employers-need-know

---

*Research dossier prepared 2026-05-22 for mushi-mushi public tester marketplace planning. Not legal advice; engage counsel before launch.*
