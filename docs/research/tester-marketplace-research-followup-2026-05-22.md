# Tester-Marketplace Research Follow-up — Dual-Audience Rewards & Amazon Gift Cards (May 22, 2026)

A focused follow-up to [`tester-marketplace-research-2026-05-22.md`](./tester-marketplace-research-2026-05-22.md), targeting two open questions: (1) how dual-audience platforms balance closed-loop and cash rewards across "people who build on us" vs "people who use us", and (2) what an Amazon-gift-card rail actually looks like in 2026 if mushi-mushi ships one.

> Methodology: ~12 parallel web/firecrawl queries plus targeted scrapes of the primary sources (Roblox Help, Amazon Incentives API docs, Tango licenses page, BetaTesting Help, etc.). All claims are cited inline. Tax/legal commentary is research, **not legal advice** — consult counsel before launch.

---

## Question 1 — Dual-audience rewards duality (~700 words)

### 1. Roblox DevEx — devs cash out, end users never do

Roblox's Developer Exchange is the canonical dual-audience design: only **creators** (devs of experiences and Marketplace items) can convert in-platform value to USD; ordinary players who *purchase* Robux cannot. Roblox enforces this with an "Earned Robux" balance separate from purchased Robux ([Roblox Help — Earned Robux & DevEx Rates](https://en.help.roblox.com/hc/en-us/articles/27984458742676-Earned-Robux-Earned-Robux-Wallet-and-DevEx-Rates) — *"Robux acquired in ways, such as through purchase or trading, are not eligible for DevEx."*).

The current parameters (verified May 2026):

- **Cash-out floor:** 30,000 Earned Robux ([Roblox Help — DevEx Info Page](https://en.help.roblox.com/hc/en-us/articles/13061189551124-Developer-Exchange-Help-and-Information-Page)) — **not** $10,000 Robux ≈ $35.94 USD as the question posited. The original (pre-2022) floor was 100,000 R$, raised cadence raises it further; today **30,000 R$ → $114 USD at the New Rate** ($0.0038/R$ for Robux earned ≥ Sep 5, 2025) or **$105 USD at the Old Rate** ($0.0035/R$ for older balances).
- **Tax gate:** W-9 (US) / W-8BEN (non-US) collected at first cash-out via the Tipalti-backed DevEx portal; not at issuance.
- **Cadence:** one cash-out per calendar month ([DevEx Eligibility FAQ](https://en.help.roblox.com/hc/en-us/articles/27954482561300-DevEx-Eligibility-General-Questions)).
- **End-user reward path:** none. Players who don't create get *zero* DevEx-eligible value. Their reward is the experiences, avatar items, and Premium grant (1,000 R$/mo), which are closed-loop only.

The lesson: Roblox aggressively *segments* the redemption rails to keep the platform from becoming a money transmitter at the player tier, then concentrates KYC and tax overhead on the much smaller creator population.

### 2. HackerOne / Bugcrowd — pure cash; reputation is unmonetized but load-bearing

Bug-bounty hunters are end users of the customer's app, not devs on HackerOne itself — and they get **only cash** (PayPal / bank transfer / BTC / USDC, gated by tax form) ([HackerOne — Receiving Payments](https://docs.hackerone.com/en/articles/8395706-receiving-payments)). Cash works because the customer (the program owner) is the actual payer; HackerOne is the marketplace, not the issuer of value. There is no closed-loop currency to design around.

HackerOne's reputation is what gates the *next* paycheck, not this one: high reputation → private-program invitations (the highest-EV bounties), via the **90-day leaderboard** formula `Reputation × Signal Percentile × Impact Percentile` where *"a #1 ranked hacker receives 40% of invitations, #2 receives 30%, #3 receives 20%"* ([HackerOne — 90-Day Leaderboard](https://docs.hackerone.com/en/articles/8456917-90-day-leaderboard); [HackerOne — Reputation](https://docs.hackerone.com/en/articles/8369865-reputation)). Reputation alone isn't worth dollars — but losing it cuts you out of the bounty queue entirely. That's the retention mechanic.

### 3. Stack Overflow — pure closed-loop, never cash

Stack Overflow has *never* converted reputation to money. Privileges unlock at fixed thresholds — vote (15), bounty (75), down-vote (125), reduce ads (200), close-vote queue (500), edit (2,000), close/reopen (3,000), moderator tools (10,000), site analytics (25,000) ([Stack Overflow — Privileges](https://stackoverflow.com/help/privileges?tab=all)). Top users don't churn because reputation is **status + power**, not value, and is non-fungible across the network. This is the cheapest, lowest-risk reward design in the entire data set — and the one mushi-mushi can ship in a weekend for the dev side of its house.

### 4. GitHub Sponsors + Open Collective — straight cash to maintainers

Both are pure-cash rails with no platform-credit hybrid. **GitHub Sponsors charges 0%** for individual sponsors (Stripe processing only) and **up to 6% for organization sponsors** (3% card processing + 3% GitHub fee, reducible to 3% via invoice billing) ([GitHub docs — GitHub Sponsors tax info](https://github.com/github/docs/blob/main/content/sponsors/receiving-sponsorships-through-github-sponsors/tax-information-for-github-sponsors.md); [GitHub Blog — What's new with Sponsors](https://github.blog/open-source/maintainers/whats-new-with-github-sponsors/)). W-9 is mandatory before publishing a profile; Stripe issues the 1099. **Open Collective via Open Source Collective** as fiscal host charges a 10% admin fee ([Open Source Collective docs](https://github.com/Open-Source-Collective/docs/blob/main/campaigns-programs-and-partnerships/github-sponsors.md)). Neither has a closed-loop-credit option.

### 5. Twitch & Patreon — the canonical viewer→creator currency split

Twitch is the textbook dual-currency design: viewers buy **Bits** at $0.014/bit (100 Bits = $1.40 retail), creators receive a flat **$0.01/bit** regardless of pack size; mobile in-app adds ~30% on top ([Twitch Bits Guide 2026](https://stream-rise.com/twitch-bits-guide)). Channel subs are sold to viewers at $4.99/$9.99/$24.99 (Tiers 1/2/3); the creator split is **50/50 baseline, scaling to 60/40 or 70/30** under the Plus Program based on accumulated Plus Points ([Twitch Subs Guide 2026](https://stream-rise.com/twitch-subs-guide)). Payouts NET 15 monthly with a $50 floor. Patreon now sits at a **10% platform fee** for new creators (post-Aug 4, 2025) plus payment processing, vs. the grandfathered "Pro" plan's 8% ([Patreon Help — Creator fees overview](https://support.patreon.com/hc/en-us/articles/11111747095181-Creator-fees-overview)).

The viewer pays in retail currency, the creator receives cash. There is no "convert your Bits to a Discord Nitro discount" rail — once you spend Bits they're consumed by the platform, not refundable to USD or any other product. **No dual-audience platform actually ships the "convert credits to upgrade with a bonus" idea natively.**

### 6. The "convert with a bonus" pattern — where it lives in 2026

The pattern exists, just not on creator platforms. It lives in **credit-card transfer bonuses**: Amex Membership Rewards, Chase Ultimate Rewards, Citi ThankYou, Capital One Miles routinely run **20–55% bonuses to specific airline/hotel partners**, with Chase's 65% Marriott bonus in May 2026 being the high-water mark ([The Points Guy — Current Transfer Bonuses](https://thepointsguy.com/loyalty-programs/current-transfer-bonuses/); [Roaming Cactus — May 2026 Transfer Bonuses](https://roamingcactus.com/deals/may-2026-transfer-bonuses); [TransferPoints — Live Transfer Bonuses](https://transferpoints.com/bonuses)). It also appears in SaaS credit-pricing playbooks — Notion sells **Custom Agent credits** with bundled-plus-overage hybrid economics ([Notion Help — Custom Agent pricing](https://www.notion.com/help/custom-agent-pricing); [Growthpad — Credit-Based Pricing Playbook](https://growthpad.blog/2026/04/01/the-credit-based-pricing-playbook/)). LinearB allows two months of free overage annually at 120% as a "ramp-up flex" — same idea, different name ([LinearB — How Credits Work](https://linearb.io/how-credits-work)).

### Synthesis for mushi-mushi

| Option | Eng cost (1=cheap) | Funnel strength (5=best) | Legal exposure (1=safe) | Tester satisfaction (5=high) | Net |
|---|---|---|---|---|---|
| **(A) Single mushi-points, 1.3× bonus on Pro upgrade, base-rate gift-card cash-out** | 3 | **5** | 2 | 4 | **Strongest** |
| (B) Two currencies (mushi-points cash, mushi-credits Pro) | 2 | 3 | 1 | 3 | medium |
| (C) Closed-loop for non-devs, cash-out only for verified KYC users | 2 | 2 | 2 | 2 | weakest |

**Recommendation: (A).** One ledger, two rails. The 1.3× premium on Pro-upgrade redemption is functionally a discount/coupon (issuer-funded price adjustment, not "additional compensation"), aligning with the Anikeev safe harbor for rebate-class points ([Anikeev v. Commissioner, T.C. Memo 2021-23](https://casetext.com/case/anikeev-v-commr); [Tax Adviser](https://www.thetaxadviser.com/issues/2021/may/credit-card-rewards-purchases-gift-cards/)). The base-rate gift-card rail is taxable income at FMV at redemption — exactly the Swagbucks / BetaTesting posture. The funnel: every tester who has accumulated points faces a 30% premium to keep their reward inside mushi-mushi, which is the most direct possible nudge to upgrade.

---

## Question 2 — Amazon gift cards in 2026 (~800 words)

### 1. Amazon Incentives API — direct integration

The **Amazon Incentives API** (AGCOD) is Amazon's first-party rail for programmatically issuing digital Amazon.com / Amazon.co.uk / Amazon.de etc. gift cards. Eligibility is gated behind an **email-only conversation with an Amazon account manager** ([Amazon Incentives API — Onboarding Process](https://developer.amazon.com/docs/incentives-api/onboarding-process.html) — *"To obtain a partner ID, please contact the account management team for your specific marketplace."*). Sandbox and production environments live behind separate AWS-style access-key pairs (rotated every 90 days). The settlement model is **prepaid balance**: you wire funds, AGCOD deducts on each `CreateGiftCard` call. Region endpoints split NA / EU+ME / FE, and partners cannot store claim codes long-term per the AGCOD Data Storage Guidelines.

Amazon does **not publish** a minimum monthly spend, but the contract is enterprise-style — partners report it commonly lands in the four-to-five-figure-monthly range, with the reseller program reserved for partners with an "approved Program ID" ([Amazon Incentives API — Onboarding](https://developer.amazon.com/docs/incentives-api/onboarding-process.html)). The implication for mushi-mushi: AGCOD direct is not the v1 rail. The integration burden (PGP for test cards, prepaid funding, IT-manager user provisioning) and the contact-gated onboarding push small startups to resellers.

### 2. Tango / Tremendous / Giftbit — the reseller layer

All three are Amazon-authorized resellers. **Tremendous is the cleanest fit for v1**:

- **Platform fee: 0%** for gift-card / prepaid-Visa / charity redemptions, **6% (min $1)** for ACH / PayPal / Venmo (paid by recipient, not sender) ([Tremendous vs Tango — comparison page](https://www.tremendous.com/compare/tango-card/); [BetaTesting Help — Redeeming Rewards with Tremendous](https://help.betatesting.com/en/articles/10602302-redeeming-rewards-with-tremendous)).
- Credit-card funding fee 3%; physical Visa cards free; custom-branded campaigns free.
- 2,000+ redemption options across 200+ countries.

**Tango Card** competes on enterprise breadth (3,100+ gift card options in 60+ currencies via Reward Genius), but charges fees Tremendous doesn't (campaign customization, physical card fulfillment, etc.) ([SpotSaaS — Tremendous vs Tango vs Giftbit](https://www.spotsaas.com/compare/tremendous-vs-tango-card-vs-giftbit)). **Giftbit** is the smallest of the three but the most transparent on breakage-sharing — defaulting to 25% of unclaimed value flowing back to the sender ([Giftbit — Tremendous/Tango alternatives](https://www.giftbit.com/tremendous-tango-alternatives)).

The "$25 Amazon card" stack via Tremendous: $25 face value, 0% platform fee, 0% Amazon SKU surcharge for Tremendous senders — the only marginal cost is credit-card funding (3% on top-up if not using ACH/wire). Tango bills similarly but with line-item add-ons for branding.

### 3. Money-transmitter posture

Tango operates **as an authorized delegate of Blackhawk Network California, Inc. (NMLS ID: 925953)** across the majority of U.S. states, with a few states where existing money-transmitter law simply doesn't apply to its business model ([Tango Card — Licenses](https://www.tangocard.com/legal/licenses) — *"Tango Card, Inc., is either a licensed money transmitter or is operating as an authorized delegate of Blackhawk Network California, Inc., to provide regulated money transmission activities in certain jurisdictions."*). The list runs through ~40 states explicitly. Tremendous follows the same model (Blackhawk delegate). **Mushi-mushi buying $25 Amazon cards in bulk from Tango and re-issuing to testers shields mushi-mushi from state-by-state MTL licensing**, provided mushi-mushi isn't doing settlement itself — it's a sender, Tango is the transmitter.

Note: Tango settled with OFAC in Sept 2022 for $116,048.60 covering 27,720 sanctions violations from deficient geolocation processes ([OFAC — Tango Card Settlement](https://ofac.treasury.gov/recent-actions/20220930_33)). Geofencing the OFAC-blocked countries (Cuba, Iran, Syria, North Korea, Crimea) at the mushi-mushi sender layer is still recommended — Tango won't necessarily catch you a second time.

### 4. International testers — Reward Link / Global Choice Link

Tango's **Reward Link** ships a single URL the recipient redeems against a curated 100+ card catalog ([Tango — Reward Link](https://www.tangocard.com/reward-link/)). Its sibling product **Global Choice Link** lets the recipient self-select country + currency at redemption, then surfaces 800+ locally-relevant brands in 225+ countries and 60+ currencies, with FX calculated daily based on brand + recipient location ([Tango — Global Choice Link](https://www.tangocard.com/global-choice-link); [Tango Help — Send international rewards](https://help.rewardsgenius.com/articles/en_US/Knowledge/Sendinternationalrewards)). A UK tester who picks "United Kingdom" sees Amazon.co.uk; a US tester picks Amazon.com. The sender pays in their own account currency; FX is rolled into the daily rate. This is the cleanest mushi-mushi answer to "tester in Vietnam wants their reward today."

### 5. Breakage

Industry breakage runs **5–15% of total value** unredeemed; ~14% of value overall, with digital cards at **91% redemption vs. 82% for physical** ([Ncentiva — Gift Card Breakage](https://www.ncentiva.com/blog/gift-card-breakage-what-it-is-why-it-matters-and-how-to-handle-it); [SchedulingKit — 50 Gift Card Industry Statistics](https://schedulingkit.com/statistics/gift-card-industry-statistics); [Enjovia — Gift Card Statistics](https://enjovia.com/what-percentage-of-gift-cards-go-unused/)). Annual U.S. unspent gift-card value: **~$21 billion / $4.7B breakage revenue**. **Giftbit returns 25% of unclaimed value to sender by default; Tango shares ~75% of breakage; Tremendous doesn't publish a number** ([Giftbit — Tango/Tremendous comparison](https://www.giftbit.com/tremendous-tango-alternatives)). For mushi-mushi's v1 economics, assume ~10% breakage flows back from Tango/Giftbit as a partial offset to face-value spend — meaningful but not large enough to design around.

### 6. Amazon's gift-card terms — marketing language matters

Amazon's terms are unambiguous: cards *"cannot be reloaded, resold, transferred for value, used for unauthorised commercial purposes, including to facilitate the resale or shipment of goods from Amazon.co.uk, redeemed for cash, or used in a manner otherwise prohibited"* ([Amazon.co.uk — GC Terms](https://www.amazon.co.uk/gp/help/customer/display.html?nodeId=GNG9PXYZUMQT72QK); see also [Amazon.com — Corporate GC Terms](https://www.amazon.com/gp/help/customer/display.html?nodeId=202120960)). **You may not "sell or exchange a gift card for cash or for any other prepaid payment instrument."** Per-currency cards do not cross borders — a UK card cannot be used on Amazon.com.

**Marketing implication**: mushi-mushi should *not* describe the program as "earn Amazon gift cards" as the lead. The compliant framing is "earn rewards — redeem for any of 100+ options including Amazon" (the Tremendous/Tango framing). This sidesteps the prohibited "Amazon gift cards as cash equivalent" interpretation and gives mushi-mushi room to swap the Amazon SKU if Amazon ever rate-limits the reseller mid-month.

### 7. What other tester platforms ship today

**BetaTesting transitioned exclusively to Tremendous in June 2025**, retiring direct PayPal, and bumped base tester rewards >20% to offset the 6% PayPal/ACH/Venmo fee that the *tester* now pays ([BetaTesting Help — Tremendous](https://help.betatesting.com/en/articles/10602302-redeeming-rewards-with-tremendous)). Apple TestFlight pays **nothing** — testers are devs' personal pools. UserTesting pays via PayPal direct, with a separate prepaid-Visa option for non-PayPal countries. The 2026 market signal is clear: **resellers (Tremendous especially) won** — direct PayPal is a maintenance burden and a per-country footgun.

### 8. Implementation cost via Tremendous

- **Onboarding:** account in <1 hour; KYB review typically 1–3 business days (much faster than AGCOD direct).
- **API surface:** ~6 endpoints touch v1 — `POST /v2/orders` (create order), `GET /v2/orders/:id` (status), `GET /v2/products` (catalog), `GET /v2/funding_sources`, `GET /v2/balance`, plus webhook on redemption.
- **PCI/SOC posture on mushi side:** none. Tremendous never sends raw card data to mushi-mushi; the recipient receives a Tremendous-hosted redemption URL. SOC 2 is *not* required to integrate.
- **Failure modes:** invalid recipient email → Tremendous bounces and credits the funding source back; un-redeemed orders auto-expire per policy (typically 90 days, refunded to sender); Amazon SKU rejection mid-month → recipient sees Amazon greyed out at redemption and picks from the rest of the catalog. None of these failure modes block mushi-mushi from issuing the next reward.

### 9. The "Mushi Pro premium" — is the 1.3× bonus a discount or compensation?

This is the most legally important question in the entire follow-up. The Anikeev concession ([Anikeev v. Commissioner](https://casetext.com/case/anikeev-v-commr); [Current Federal Tax Developments](https://www.currentfederaltaxdevelopments.com/blog/2021/2/26/taxpayer-escapes-paying-tax-on-nearly-300000-of-credit-card-rewards-achieved-by-buying-gift-cards)) plus the IRS's long-standing informal policy treat **issuer-funded discounts as price adjustments, not income**. Offering "redeem 1,000 points for $13 of Mushi Pro credit" is structurally identical to "show this coupon for 30% off your subscription" — the issuer (mushi-mushi) is funding the discount from its own product. The recipient never receives a third-party FMV; no 1099 event.

The gift-card path is a *separate* tax universe: $10 Amazon card redemption is taxable income at FMV, reportable on 1099-MISC when aggregate annual FMV ≥ $600. Tremendous's W-9 collection at $2,000 cumulative is the trigger to wire ([Giftogram — W-9 collection for digital gift cards](https://giftogram.com/blog/w-9-collection-1099-compliance-for-digital-gift-card-rewards-made-easy-with-giftogram)).

**Conclusion: the "premium for staying in-platform" is legally cleaner than the gift-card payout, not dirtier.** It's a coupon. It also funnels harder.

### Synthesis — v1 vendor + reward catalog

**Vendor: Tremendous (not Tango Card direct, not AGCOD direct).** Zero platform fee, 6% only on cash rails (paid by recipient), Blackhawk-delegate MTL coverage, identical Reward-Link mechanic, easier KYB onboarding than Tango. Reserve a future AGCOD-direct migration if Amazon volume justifies the contract.

**User-visible reward catalog (one mushi-point ≈ $0.01 of gift-card face value at base rate; 1.3× premium on Mushi Pro redemptions):**

| Reward | Face value | mushi-points (base rate) | mushi-points (1.3× Pro rate) |
|---|---|---|---|
| Mushi Pro — 1 month | $19 / mo | n/a | **1,460 pts** (= $19 / 1.3) |
| Mushi Pro — 1 year | $190 / yr | n/a | **14,600 pts** |
| API quota — +100K tokens | $5 | n/a | **385 pts** |
| Amazon.com gift card | $5 | 500 pts | n/a |
| Amazon.com gift card | $10 | 1,000 pts | n/a |
| Amazon.com gift card | $25 | 2,500 pts | n/a |
| Amazon.com gift card | $50 | 5,000 pts | n/a |
| Visa prepaid (open-loop, US only) | $25 | 2,500 pts | n/a |
| Starbucks / Steam / App Store (Tremendous SKUs) | $5 / $10 / $25 | matches face | n/a |
| Global Choice Link (international) | $25 equivalent | 2,500 pts | n/a |

Floor: 500 pts minimum to redeem anything. Cap: $599/year per US tester for v1 (avoids 1099 burden until tax pipeline matures). KYC + W-9 trigger at $200 lifetime cash-rail redemptions, even though Tremendous's own trigger is $2,000 — being more conservative buys margin for sloppy v1 reporting. Per-month redemption cap of $100 to throttle fraud farms.

This catalog gives every tester two real choices on every redemption screen — the cash-equivalent path that justifies their session time, and a 30%-discounted "become a Mushi dev for what your testing earned" path. The dev-side audience picks Pro instinctively; the public-tester audience sees Pro every time they cash out and is gradually socialized into the funnel. That is the cleanest hybrid the data supports.
