# lets-talk: store listing drafts and App Review risk analysis

| | |
|---|---|
| App | **lets-talk – Conversation Coach** (Play title, exact, 30 chars) |
| Play package | `us.kensaur.howtotalktogirls` |
| iOS bundle id | `us.kensaur.howtotalktogirls` (ASC app id 6799392790) |
| Repo | `kensaurus/cooler-heads` at `4b1dd24` (2026-09-28). Read only; nothing edited |
| Live site | https://talk.kensaur.us (read only) |
| Status | **DRAFT, 2026-10-02.** Nothing was pushed to either store. iOS 1.1.0 was rejected again, and the letter is not in hand yet. |

> **Read this first.** The repo already decided most of this. ADR 0010
> (`docs/adr/0010-rename-to-lets-talk.md`) set the store name to
> `lets-talk – Conversation Coach` in every locale on 2026-09-28. The copy is
> staged in `distribution/listing/<locale>/`, and `npm run listing:check`
> enforces it. This file does not write a second listing. It proposes
> **changes to the staged files, each with a reason**, and the main reason is
> the review risks in §8.

---

## 1. Current listing state (what is live, what is staged)

| Surface | Name / title today | Evidence |
|---|---|---|
| Google Play (en-US and ja) | **`lets-talk – Conversation Coach`**. The short description reads "Rehearse the talk you're dreading and get a reply you can actually send." | `curl` of the Play page `<title>` on 2026-10-02 (en_US/US and ja/JP) |
| App Store, live version 1.0.0 | **`How to Talk to Girls`**, rated 17+ in the US and JP storefronts. Genres: Education, Lifestyle | `itunes.apple.com/lookup?bundleId=us.kensaur.howtotalktogirls`, 2026-10-02 |
| App Store, 1.1.0 (rejected) | `Cooler Heads`. This build's `CFBundleDisplayName` = `Cooler Heads` | owner brief; `git show 7c7944a:ios/App/App/Info.plist` |
| Repo HEAD, native label | `lets-talk` | `capacitor.config.ts` (`appName`), `android/app/src/main/res/values/strings.xml` (`app_name`), `ios/App/App/Info.plist` (`CFBundleDisplayName`) |
| Staged store name | `lets-talk – Conversation Coach` | `scripts/listing-check.mjs:38` (`APP_NAME`); `BRAND = 'lets-talk'` at :41 |
| Staged per-locale copy | 7 locales: en-US, ja, ko, zh-Hans, de, fr, es | `distribution/listing/<locale>/{subtitle,keywords,promo-text,short-description,full-description}.txt` |
| Staged What's New | en-US only (283 chars) | `distribution/whatsnew/whatsnew-en-US.txt` |
| Staged review notes | Guideline 1.1 reply, deletion steps, and the 2.1(b) answers | `distribution/review-notes-en-US.txt` |
| Website | Every page title already reads lets-talk: `/` = "lets-talk: score a tense text before you send"; `/privacy`, `/support` and `/compare/alternatives` = "… — lets-talk" | `curl` on 2026-10-02 |

**Review history (from `docs/store-release-checklist.md` and ADR 0009):**

| Date | Version / build | Guideline(s) cited |
|---|---|---|
| 2026-08-21 | 1.0.0 (113) | 4 Design (OAuth opened Safari), 2.1(a) (no demo access) |
| 2026-08-25 | 1.0.0 (118) | 5.1.1(v) (deletion not completable), 2.1(b) (business model) |
| 2026-08-31 | 1.0.0 (120) | **Approved.** Live as *How to Talk to Girls* |
| 2026-09-21 | 1.1.0 (126) | **1.1 Objectionable Content**: name, keywords, description, What's New. The account was put on **Extended Review**, with the warning that "similar marketing and concept" re-violates |
| 2026-09-22 → ? | 1.1.0 (build from `7c7944a`, run 35683315228) as *Cooler Heads* | **Rejected. Letter not yet provided.** |

The owner decided: **follow the Google Play name everywhere.** That is
exactly ADR 0010, so the iOS name becomes `lets-talk – Conversation Coach`
and the home-screen label is `lets-talk`.

## 2. Metadata push mechanism (names only, no values)

| Piece | Path | What it does |
|---|---|---|
| Listing push | `scripts/push-store-listing.mjs` (+ `.test.mjs`) | Apple: name, subtitle, keywords, promo, description, review notes and screenshots for every locale. Writes only to a version in `PREPARE_FOR_SUBMISSION` or rejected. Play: every live language, screenshots and the feature graphic. Modes: `dry-run` / `validate` (Play) / `apply` / `promo` (Apple, live version only) |
| Workflow | `.github/workflows/store-listing.yml` (manual dispatch: `store` = apple / play / both, plus `mode`) | Builds, captures screenshots, runs the push script |
| Submit | `scripts/submit-app-store.mjs` | Attaches the build, writes the listing and What's New from `distribution/`, submits for review. Repo var `APPLE_AUTO_SUBMIT_PRODUCTION` |
| Build | `.github/workflows/build-mobile-capacitor.yml` | Android AAB to Play; iOS IPA through `altool`, then the submit script |
| Gate | `scripts/listing-check.mjs` (`npm run listing:check`, runs in `ci.yml`) | Lengths, price words, platform names, 1.1 terms, retired brands, closing paragraph |
| No fastlane | none | none |

Env names read by the scripts: `APPLE_API_KEY_ID`, `APPLE_API_ISSUER_ID`,
`APPLE_API_KEY_PATH`, `APP_STORE_CONNECT_APP_ID`, `GOOGLE_PLAY_PACKAGE`,
`GOOGLE_PLAY_SERVICE_ACCOUNT_PATH`, `APP_VERSION`, `BUILD_NUMBER`,
`WHATSNEW_DIR`, `APPLE_RELEASE_TYPE`, `SUBMIT_FAIL_ON_ERROR`.

GitHub Actions secrets: `gh secret list` shows **all present**, with names
and set dates only.

| Secret | Set on |
|---|---|
| `HTTTG_APP_STORE_CONNECT_API_KEY_ID`, `HTTTG_APP_STORE_CONNECT_ISSUER_ID`, `HTTTG_APP_STORE_CONNECT_API_KEY_P8` | 2026-08-09 |
| `HTTTG_APPLE_TEAM_ID`, `HTTTG_IOS_CERTIFICATE_P12`, `HTTTG_IOS_CERTIFICATE_PASSWORD`, `HTTTG_IOS_PROVISIONING_PROFILE` | 2026-08-09 |
| `HTTTG_GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | 2026-08-09 |
| `HTTTG_ANDROID_SIGNING_KEY`, `HTTTG_ANDROID_KEYSTORE_PASSWORD`, `HTTTG_ANDROID_KEY_ALIAS`, `HTTTG_ANDROID_KEY_PASSWORD` | 2026-08-08 |
| `HTTTG_OTA_PRIVATE_KEY` | 2026-09-27 |
| `SENTRY_READ_TOKEN` | 2026-09-27 |
| `AWS_ROLE_ARN` | 2026-07-22 |

Repo variables: `VITE_SENTRY_DSN` and `APPLE_AUTO_SUBMIT_PRODUCTION`.

**Missing:** nothing that the listing push or the submit step needs. The last
successful `store-listing.yml` runs were 2026-09-28 (3 runs on `1cdf094`).
None of these values were read or printed.

## 3. Feature inventory (evidence-backed)

Every listing claim below traces to one of these rows.

| Feature | What it is | Evidence |
|---|---|---|
| **Write** (`/learn`) | Score a draft on four parts: observation, feeling, need, request. *Easy* means you pick a reply, with no key and no AI. *Hard* means you write your own and Claude scores it. 21 scenarios in three lanes (checked-out / said-it-wrong / dropped-ball) | `src/features/nvc-learn/*`, `src/content/scenarios.ts`, `src/i18n/resources/en/learn.json:14-17` |
| **Role-play** (`/simulate`) | 12 persona scenes. Relationships: girlfriend, wife, partner, spouse, friend, parent, coworker. Vibe meter, mid-turn coach note, debrief, culture presets (9), speech styles | `src/content/personas.ts`, `src/features/simulation/*`, `src/content/culture-graph.ts`, `src/i18n/resources/en/simulate.json` (`debrief`) |
| **Advise** (`/advise`) | Paste what they said, get a read of their side plus reply drafts | `src/features/advise/*` |
| **Field notes** (`/notes`) | 7 short articles that work offline with no key. Share = a link to a static note | `src/content/field-notes.ts`, `src/lib/field-note-share.ts` |
| Style map | Optional questionnaire, stored locally; a short prompt block is added to AI calls | `src/features/self-profile/*` |
| LLM | Anthropic Claude (`claude-opus-5` default, `claude-sonnet-5`, `claude-haiku-4-5`) | `src/features/byok/@_byok-README.md` |
| Guest try | About $0.50 / 40 requests per device, relayed by the `htttg-chat` edge function to `api.anthropic.com`. **Per-IP lifetime cap of $1.50 / 80 requests**, and a $20/day global cap | `supabase/functions/htttg-chat/index.ts:51`, `supabase/migrations/20260822120000_htttg_guest_caps.sql`, `…20260826130000_htttg_guest_reserve_balance.sql:16-17,75-80` |
| **BYOK** | The user pastes their own Anthropic key. It stays in local storage, and the client calls Anthropic directly | `src/features/byok/*`, `src/features/chat-core/anthropic-client.ts` |
| Account (optional) | KENSAURUS account through Google, Apple, or an email OTP | `src/features/account/sign-in-form.tsx:57-111` |
| Payments | Stripe credit packs, **web only**. Native hides the buy buttons (`isNativeShell()`). No IAP, no RevenueCat | `src/lib/native-shell.ts`, `src/features/account/balance-chip.tsx`, checklist "Billing rules" |
| Deletion | "Delete my data on this device" (works signed out). "Delete account" calls the `htttg-delete-account` edge function | `src/features/account/account-deletion.ts`, `supabase/functions/htttg-delete-account/` |
| UGC / user-to-user | **None.** No profiles, matching, or messaging | No such code; review notes |
| Telemetry | Funnel events on production **web only**; native emits none. Sentry crash reports **opt-in**. Langfuse summary traces with no prompt text | `src/lib/kensaurus-events.ts` (`isProductionWeb()`), `src/features/byok/@_byok-README.md`, `supabase/functions/_shared/langfuse.ts`, `/privacy` |
| OTA | Capgo updater, self-hosted and signed. **Android only.** iOS is off unless `VITE_OTA_IOS_ENABLED=1`. The plugin is linked in the iOS SPM package at HEAD | `src/lib/live-update.ts:32-56`, `ios/App/CapApp-SPM/Package.swift` |
| Native plugins | `@capacitor/app` (deep link), `@capacitor/browser` (SFSafariViewController for OAuth), Capgo updater. **No permission purpose strings** are needed: there is no camera, microphone, or location | `ios/App/CapApp-SPM/Package.swift`, `ios/App/App/Info.plist` |
| Locales | en, ja, ko, zh-Hans, de, fr, es. **Only ja is human-reviewed**; the other five show an "unreviewed" banner | `src/i18n/locales.ts`, `docs/I18N.md` |
| Devices | Universal: `TARGETED_DEVICE_FAMILY = "1,2"`, iOS 15+ | `ios/App/App.xcodeproj/project.pbxproj:312,333` |

Git history from the last 60 days (55 commits) is mostly store work:
- **2026-09-22:** the Cooler Heads rename after the 1.1 rejection (#64).
- **2026-09-28:** the lets-talk rename (#80).
- Store listing API push (#66, #69, #70), iOS auto-submit (#51), Android OTA (#76).
- Account deletion and the guest try (#53, `c08ff61`, `a828635`).
- KENSAURUS passport and spine (#55, #57, #82, #84).
- An iPad character-sheet overflow fix (#68).

## 4. Positioning, and why

The listing positions lets-talk as a **conversation-skills practice coach for
hard conversations**. It is consent-forward and relationship-neutral: partners,
friends, family, and coworkers. It uses no "pickup", "get girls", "seduce",
"game", "dating", "rizz", or "flirt" framing, in any language.

- **The package name is the risk carrier.** `howtotalktogirls` frames a gender
  as the target, which is what Guideline 1.1.1 names and what got 1.1.0 (126)
  rejected. Apple has the account on Extended Review, and its letter warned
  that "similar marketing and concept" re-violates. Any copy that even hints
  at dating gets read through that lens.
- **Play risk is parallel.** Play policies on Inappropriate Content (sexual
  content) and Deceptive Behavior / Misleading Claims (the listing must match
  the app) apply. The neutral coach framing stays clear of both.
- **The Play package id can never change.** Changing it means a new app, and
  installs and reviews start from zero. The iOS bundle id cannot change after
  upload either.
- **Correction to the brief: the bundle id is *not* fully invisible.** The live
  `/privacy` page prints `lets-talk (us.kensaur.howtotalktogirls)` in its
  header (curl on 2026-10-02). The OAuth URL scheme also carries it. A
  reviewer who opens the privacy link reads "howtotalktogirls". See risk R1.
- **Gender-neutral where the code allows.** The listing names "partners,
  friends, parents, and coworkers". The **app itself** still leads Role-play
  with a gendered *Girlfriend* scene (see R1). The listing can't fix that
  alone.
- **Health framing is out.** The staged keywords `anxiety` and `shy` (en) and
  `不安` and `内向的` (ja) are dropped. They pull the listing toward
  therapy and mental-health claims, which the copy explicitly disclaims ("not
  therapy or crisis support"). "Shy" is also the classic dating-coach hook.
- **AI disclosure in the metadata.** The description now says, plainly, that
  typed text goes to Anthropic's Claude. That keeps the listing consistent
  with the in-app consent this file recommends (R2) and with App Privacy.
- **No price words in indexed fields.** The "$0.50" mention moves out of the
  description. It trips the 2.3.7 price warning in `listing-check.mjs`, and on
  iOS it invites the same 2.1(b) business-model questions again.

## 5. ASO keyword research (WebSearch, 2026-10-02)

Competitors in the niche have names like *Hard Talk Roleplay Coach*,
*Theseus – Communication Coach*, *Poised: Conversation Coach*, *Text
Simulator*, *AstuteTalk*, and *Conversable* (which advertises
"flirting / dating scenarios", the framing to avoid). In ja, クラッシ AI and
AIAVATAR lead with 会話力 トレーニング. "Conversation coach" and "communication
coach" are the category terms, and the name already holds "Conversation Coach".

| Locale | Keyword | Why |
|---|---|---|
| en | communication | Category head term; not in the name |
| en | social skill | High-intent, neutral. Apple stems singular and plural |
| en | roleplay | Matches the Role-play feature; competitors rank on it |
| en | conflict / argument | Literally what the scenarios cover. 1.1-safe |
| en | empathy / nvc | Method words. "nvc" is a niche but exact query |
| en | reply / message | "help me reply to a message" intent (Write / Advise) |
| en | apology | 6 scenario + 10 choice hits on apology/sorry in content |
| en | confidence | Outcome term, neutral |
| en | **excluded:** small talk | No small-talk feature. Writing it in would be an invented claim |
| en | **excluded:** anxiety, shy, dating, flirt, rizz | Health or dating framing (§4) |
| ja | コミュニケーション, 伝え方, 話し方 | Category head terms in ja search |
| ja | 返信, メッセージ, 話し合い | Write / Advise intent |
| ja | ロールプレイ | Role-play (相手役) |
| ja | けんか, ケンカ, 仲直り, 謝り方 | Conflict and repair. Apple does not reliably fold kana and kanji variants, so both spellings are kept |
| ja | 人間関係, 夫婦, 友達, 家族, 職場 | Relationship-neutral set that matches the persona relationships |
| ja | 共感, NVC, 自信 | Method and outcome |
| ja | **excluded:** 会話 練習 / 会話練習 | 会話 and 練習 are already in the ja subtitle, which Apple indexes |
| ja | **excluded:** 恋愛, デート, モテ, 不安, 内向的 | Dating or health framing |

Apple indexes name + subtitle + keywords. No keyword below repeats a token from
the name ("lets", "talk", "conversation", "coach") or the subtitle
("practice", "hard", "first"; ja 会話, 練習). The script checked this.

## 6. en-US draft

All counts use `[...str].length` (Unicode code points) via node, in
`scratchpad/count.mjs`. The same script ran the `SAFETY` / `PRICE` / `PLATFORM`
/ `RETIRED` regexes from `scripts/listing-check.mjs` over every string: **0
hits**. The closing KENSAURUS paragraph is verbatim.

### App Store

| Field | Limit | Count | Change vs staged |
|---|---|---|---|
| Name | 30 | **30** | Unchanged (ADR 0010) |
| Subtitle | 30 | **28** | Unchanged |
| Promotional text | 170 | **165** (staged 161) | "someone" → "an AI character". It makes clear the counterpart is AI, not a real person (1.2 / 2.3 accuracy) |
| Keywords | 100 | **98** (staged 100) | `anxiety`, `shy`, `calm` out; `message`, `apology` in |
| Description | 4000 | **1872** (staged 1491) | "$0.50" out. New "How the AI works" paragraph. Privacy line rewritten. "AI character" in the Role-play bullet. Scene coverage line added |

**Name**
```
lets-talk – Conversation Coach
```
**Subtitle**
```
Practice the hard talk first
```
**Promotional text**
```
Dreading a message or a hard talk? Rehearse it here first. Get your draft scored, practice with an AI character who pushes back, and leave with a reply you can send.
```
**Keywords**
```
communication,social skill,roleplay,conflict,empathy,nvc,reply,message,argument,apology,confidence
```
**Description** (also the Play full description, since both stores share `full-description.txt`)
```
Practice the hard conversation before it counts.

lets-talk is a coach for the message you've rewritten six times, the talk you keep putting off, and the reply you want to get right before you send it.

• Get a tense message scored before you send it (Write)
• Rehearse with an AI character who has their own mood and pushes back (Role-play)
• Get help reading what someone meant, and reply without making it worse (Advise)
• Learn why fights start and how care lands, in short plain reads (Field notes)

How it works
1. Pick a moment: a message to send, a talk to rehearse, or a reply you're stuck on. Scenes cover partners, friends, parents, and coworkers.
2. Write it or role-play it. Your draft is scored on four plain parts: what happened, how you feel, what you need, and a request the other person can say yes or no to. In role-play, a vibe meter shows the heat rising or cooling, and a debrief shows where it went sideways and why.
3. Leave with words you can actually use, with a partner, a friend, a parent, or a colleague.

Built on Nonviolent Communication, a framework used in mediation.

Private by default. Your drafts, role-plays, and progress stay on your device, and you can wipe them at any time in Settings, no sign-in needed. Field notes and Easy mode, where you pick a reply, work without AI.

How the AI works. Hard scoring, Role-play, and Advise are written by Claude, an AI model from Anthropic. When you use them, the text you typed is sent to Anthropic to produce the reply. We do not store it on our servers. A small amount of coaching is included to try, with no account. You can also connect your own Anthropic API key in Settings; it stays on your device.

lets-talk is a practice tool for communication skills. It is not therapy or crisis support.

Part of KENSAURUS — small apps, no sign-up wall. One optional account works in all of them.
```

> **Owner choice: the BYOK sentence on iOS.** "You can also connect your own
> Anthropic API key…" describes the app accurately, as 2.3 requires. It also
> draws 3.1.1 attention (R4). It mentions no buying. If R4 is the cited
> guideline, drop that one sentence. Because both stores share the file, the
> push script would then need an iOS-only description file.

**What's New** (next iOS build). Every line maps to code at HEAD or in 1.1.0.
- iOS: **374** chars.
- Play release notes: drop the last sentence → **308** chars (Play caps notes at 500).
- **Changed vs staged:** the staged opener "Same app for practicing…" tells an Extended Review reviewer that only the name changed, after the 09-21 letter cited What's New and "similar marketing and concept". The new opener says what the app is and who it is for. "On every device" → "on this device", because per-IP and daily caps (R7) can deny the try.

```
New name: lets-talk – Conversation Coach. It helps you practice hard conversations with a partner, friend, family member, or coworker before they happen. Start with Write, Advise, Role-play, or Notes right away, with no account. Some coaching is included on this device. Settings always shows Delete my data. Fixed: the role-play character sheet no longer overflows on iPad.
```
Evidence:
- rename: `1cdf094`
- guest try: `c08ff61`
- Delete my data: `a828635`, `src/i18n/resources/en/account.json:22`
- iPad fix: `7c7944a`

**Only if the R1–R3 fixes ship** (append; 185 chars; iOS total 560, Play total **494** of 500, tight):
```
Before anything you type is sent to the AI, lets-talk now asks for your OK and says where it goes. The privacy policy is one tap away in Settings. Role-play now opens on a friend scene.
```

### Google Play

| Field | Limit | Count | Change |
|---|---|---|---|
| Title | 30 | **30** | Unchanged; matches the live listing |
| Short description | 80 | **72** | Unchanged |
| Full description | 4000 | **1872** | Same text as the App Store description above |

```
lets-talk – Conversation Coach
```
```
Rehearse the talk you're dreading and get a reply you can actually send.
```

## 7. ja draft

The name stays the English string in ja. ADR 0010 rejected localizing the
descriptor (`lets-talk – 会話コーチ`): one string everywhere. ja search reach
comes from the subtitle and keywords. If the owner later wants a ja
descriptor, `play-title.txt` per locale is already supported by the gate.

### App Store

| Field | Limit | Count | Change vs staged |
|---|---|---|---|
| Name | 30 | **30** | Unchanged |
| Subtitle | 30 | **12** | Unchanged |
| Promotional text | 170 | **80** (staged 75) | "相手役" → "AI の相手役" |
| Keywords | 100 | **81** (staged 52) | `不安` and `内向的` out. Added メッセージ, 話し合い, ケンカ, 謝り方, 人間関係, 夫婦, 友達, 家族, 職場, 伝え方 |
| Description | 4000 | **937** (staged 742) | Same structural changes as en |

**Name**
```
lets-talk – Conversation Coach
```
**Subtitle**
```
気まずい会話を、先に練習
```
**Promotional text**
```
送るのが怖いメッセージや、気が重い話し合い。ここで先に練習しよう。下書きを採点し、簡単には折れない AI の相手役と練習して、そのまま送れる返事を持ち帰れます。
```
**Keywords** (ASCII commas, no spaces)
```
コミュニケーション,伝え方,話し方,返信,メッセージ,話し合い,ロールプレイ,共感,けんか,ケンカ,仲直り,謝り方,人間関係,夫婦,友達,家族,職場,NVC,自信
```
**Description**
```
大事な会話を、本番の前に練習しよう。

lets-talk は、6回書き直しても送れないメッセージ、先延ばしにしている話し合い、送る前にきちんと整えたい返事のためのコーチです。

• 気まずいメッセージを、送る前に採点（書く）
• 自分の機嫌を持ち、簡単には同意しない AI の相手と練習（相手役）
• 相手が何を言いたかったのかを読み解き、こじらせずに返事（アドバイス）
• ケンカがどう始まり、思いやりがどう伝わるかを、短く平易な読み物で（ヒントメモ）

使い方
1. 場面を選ぶ：送りたいメッセージ、練習したい話し合い、返し方に迷っている返事。パートナー、友人、親、職場の相手との場面があります。
2. 書くか、相手役と話す。下書きは4つの点で採点されます。何が起きたか、どう感じているか、何が必要か、そして相手が「はい」も「いいえ」も言えるお願い。相手役では、場の熱が上がるか冷めるかをバイブメーターが示し、終わったあとに、どこで、なぜこじれたかの振り返りが読めます。
3. パートナー、友人、親、同僚に、そのまま使える言葉を持ち帰る。

調停の場でも使われる枠組み「非暴力コミュニケーション（NVC）」に基づいています。

デフォルトでプライベート。下書き、相手役との会話、進み具合はあなたの端末の中に保存され、設定からいつでも消せます（サインイン不要）。ヒントメモと、返事を選ぶ「かんたん」モードは AI を使いません。

AI について。「むずかしい」採点、相手役、アドバイスの返答は、Anthropic の AI「Claude」が作ります。これらを使うと、入力した文章が返答を作るために Anthropic へ送信されます。こちらのサーバーには保存しません。アカウントなしで使える、お試し分のコーチングが含まれています。設定から自分の Anthropic API キーをつなぐこともできます。キーは端末の中に留まります。

lets-talk はコミュニケーションを練習するためのツールです。セラピーや危機対応の窓口ではありません。

KENSAURUS のアプリです — 小さなアプリたち、登録の壁なし。任意のアカウントひとつで、すべてのアプリを使えます。
```
Section names (書く / 相手役 / アドバイス / ヒントメモ / かんたん / むずかしい /
この端末のデータを削除) match the human-reviewed ja UI catalog:
`src/i18n/resources/ja/learn.json:14-17`, `src/i18n/resources/ja/account.json:22`.

**What's New** (ja). App Store: **203** chars. Play: drop the 修正 sentence → **168**. The opener changed for the same reason as en.
```
新しい名前は lets-talk – Conversation Coach。パートナー、友人、家族、同僚との大事な会話を、本番の前に練習できるコーチです。書く・アドバイス・相手役・ヒントメモを、アカウントなしですぐに始められます。この端末にはお試し分のコーチングが含まれています。設定には「この端末のデータを削除」がいつも表示されます。修正：iPad で相手役のキャラクターシートがはみ出さなくなりました。
```
**Only if the R1–R3 fixes ship** (append; 87 chars; App Store total 290, Play total 255):
```
入力した文章を AI に送る前に、送り先を説明して同意を確認するようになりました。プライバシーポリシーは設定からすぐ開けます。相手役は友人との場面から始まるようになりました。
```

### Google Play (ja-JP)

| Field | Limit | Count |
|---|---|---|
| Title | 30 | **30**: `lets-talk – Conversation Coach` (matches the live ja page) |
| Short description | 80 | **32**: `気が重い話し合いを先に練習して、そのまま送れる返事を持ち帰ろう。` (unchanged) |
| Full description | 4000 | **937** (above) |

## 8. Ranked review-risk analysis: likely causes of the 1.1.0 rejection

The letter has not been seen. These are **candidates ranked by evidence**, not
diagnoses. The rejected binary is `7c7944a` (Build Mobile run 35683315228,
2026-09-22). HEAD differs in 83 `src` files, mostly the rename, the spine, and
Android OTA.

| # | Guideline | Likelihood | Status | Evidence | Fix needed |
|---|---|---|---|---|---|
| **R1** | **1.1 / 1.1.1 recurrence: "similar concept"** (Extended Review) | **Likely** | Present | (a) The prior rejection of this same version, 1.1.0 (126), was for 1.1, with an explicit "similar marketing and concept" warning (ADR 0009). (b) In-app, Role-play's first relationship type and first preset are **Girlfriend** (*Maya — weekend plans*): `src/content/personas.ts:9` and `:72-83`. The setup fallback is `'girlfriend'` (`src/features/simulation/use-simulation-setup-form.ts:53`). A second girlfriend preset involves liking an ex's stories (`personas.ts:215-226`). There is also a *Wife* preset. Same in build `7c7944a`. (c) The screenshot script deliberately switches to the *Riley* friend scene so the store image "is not romance-only" (`scripts/capture-play-store-screenshots.mjs:139-147`). The reviewer sees Girlfriend first, the screenshots don't. (d) `/privacy` prints `us.kensaur.howtotalktogirls` visibly. (e) The live 1.0.0 product page still says *How to Talk to Girls* (17+) | Make **friend/coworker lead** `RELATIONSHIP_TYPES` and `PERSONA_PRESETS`, and change the fallback to a neutral type. Relabel *Girlfriend*/*Wife* as *Partner*/*Spouse*, or cut them to one each. Remove the bundle id from the visible `/privacy` header (the app name is enough; the id can sit in a non-rendered meta tag). Recapture screenshots with no persona override. Resolution Center reply: listing the in-app neutral default as well as the rename |
| **R2** | **5.1.2(i): sharing personal data with third-party AI** (rule amended 2025-11-13) | **Likely** | Present | No in-app disclosure or explicit permission before typed text leaves the device. Grepping `consent` in `src/` hits only spine, events, and Sentry code. Guest-try text goes through `htttg-chat` to `api.anthropic.com` (`supabase/functions/htttg-chat/index.ts:51`); Langfuse receives summary traces (`_shared/langfuse.ts`). Settings → Privacy only talks about key storage (`src/i18n/resources/en/settings.json:98-105`). Disclosure lives only in the web privacy policy | One-time sheet before the first AI call (Write Hard, Role-play, Advise). It names **Anthropic (Claude)**, says what is sent (typed text plus the optional style map) and that it is not stored by us, and links the privacy policy. Buttons: *Allow* / *Not now*; *Not now* leaves Easy mode and Notes working. Store the choice locally and show it in Settings with a revoke option. Then update App Privacy if needed |
| **R3** | **5.1.1(i): privacy policy reachable in-app** | Possible | Present | `PRIVACY_URL` is defined (`src/lib/site.ts:11`) but **no component renders it**. The footer shows a privacy *blurb* only (`src/app/layout.tsx:276`). The support URL isn't linked in-app either | Add Privacy policy and Support links to Settings → Privacy and to the footer (`@capacitor/browser` on native) |
| **R4** | **3.1.1 / 3.1.3 / 2.1(b): BYOK as an unlock, with steering to external paid credit** | Possible | Present | On native, when the try runs out, the app says "Use your own Anthropic key in Settings to keep practising" (`account.json:85`, `common.json:58`). `GetKeyGuide` renders on native without gating (`api-key-form.tsx:84`, `connect-nudge.tsx:106`, `key-needed-banner.tsx:68`). It says "Add a little credit… Claude bills you directly… Billing is in the Anthropic Console" with a console.anthropic.com link (`settings.json:87-90`). 1.0.0 already drew 2.1(b) questions (2026-08-25). Mitigated in part: no buy buttons on native, review notes answer 2.1(b) | On native, hide the billing and credit step plus the console links. Present the key as optional, for people who already have one. Never say "to keep practising". Keep the review-notes 2.1(b) block |
| **R5** | **2.3.7 / 2.3.8 / 2.3: metadata accuracy and consistency** | Possible | Present for build `7c7944a` | Binary and ASC say *Cooler Heads*, while the privacy, support, and compare pages the reviewer opens say *lets-talk*, and so does Play (curl 2026-10-02). Screenshots curate a non-default scene (R1c). The live listing reads *How to Talk to Girls* | Ship name, binary, site, and screenshots together as **lets-talk – Conversation Coach** (HEAD already has `lets-talk` in all three native configs). Never resubmit the `7c7944a` build |
| **R6** | **5.1.1 / App Privacy label drift** | Unknown | Unknown | The checklist says **Crash Data had to be declared before the next native release**, because CI has baked `VITE_SENTRY_DSN` into Capacitor builds since 2026-09-20; `7c7944a` was built after that. Whether ASC was updated is not recorded. Third-party AI processing (Anthropic) needs to be consistent with R2 | Owner: confirm that App Privacy has *Diagnostics → Crash Data* (not linked, not tracking). Confirm that "User Content" is declared accurately given relay processing. Mirror this in Play Data safety |
| **R7** | **2.1: completeness / reviewer can't reach features** | Possible | Partly mitigated | Guest try: device $0.50 / 40 requests, plus **per-IP lifetime** $1.50 / 80 requests with no reset window (`…20260826130000_htttg_guest_reserve_balance.sql:16-17,75-80`), plus a $20/day global cap. Apple review traffic from shared egress IPs across 3+ review rounds may already have used the IP allowance, which would show "included try used up" to the reviewer. A dead relay (Kenji project) would look like a broken app. Live DB state not checked (read-only brief) | Owner: check `htttg_guest_ip_spend` for heavily used IP hashes before resubmitting. Consider a review demo path that is not IP-capped, such as review-only credits on a demo account given in the notes |
| **R8** | **4.2: minimum functionality / web wrapper** | Low | Mitigated | `capacitor.config.ts`: `webDir: 'dist'`, **no `server.url`**, so the bundle is local. Offline Notes and Easy mode, native Sign in with Apple, SFSafariViewController auth, deep link. But the identical app is free on the web, and native features are thin | Optional: add one sentence to the review notes on offline use and native sign-in. Nothing blocking |
| **R9** | **2.5.2 / 3.3.x: downloaded code** | Low | Not in the rejected build; present at HEAD | `CapgoCapacitorUpdater` is linked in the iOS SPM package at HEAD (`ios/App/CapApp-SPM/Package.swift`) but disabled on iOS (`src/lib/live-update.ts:53-56`). It was absent in `7c7944a` | Keep iOS OTA off, or drop the plugin from the iOS build. If asked, say it is disabled on iOS |
| **R10** | **4.8: Sign in with Apple** | — | Mitigated | Apple sits beside Google and email OTP (`src/features/account/sign-in-form.tsx:57-78`) | None |
| **R11** | **5.1.1(v): account deletion** | — | Mitigated | "Delete my data on this device" works signed out. "Delete account" calls the `htttg-delete-account` edge function (`src/features/account/account-deletion.ts`) | None. Keep the steps in the review notes |
| **R12** | **1.2: UGC** | — | Not present | No user-to-user content. Share links only point to static field notes (`src/lib/field-note-share.ts`) | None |
| **R13** | **4.3: spam** | Low | Mitigated | Distinct function. Shared KENSAURUS spine and cross-promo only | None |
| **R14** | **1.4.1 / health framing** | Low | Mitigated | Age rating answered Health/Wellness = Yes, 16+ calculated. The "not therapy" line is in the description. This draft drops `anxiety`/`不安` | None beyond this draft |

**Most probable combination (to be confirmed by the letter):**
- **R1:** an Extended Review reviewer still finds the concept gendered in-app.
- **R2:** an AI-consent rule that Apple now cites routinely.
- **R3 and R5** could accompany either one.

## 9. Screenshot and graphics inventory

Committed in the repo (PNG header dimensions):

| File | Size | Store-usable? |
|---|---|---|
| `distribution/play-feature-graphic.png` | 1024×500 | Yes, Play feature graphic (SVG source beside it). Inspected 2026-10-02: reads "lets-talk / Practice when things get tense", with the speech-bubble mark and no retired name |
| `public/pwa-512.png` | 512×512 | Play icon source. `npm run generate:android-icons` writes the Play 512 to `.playwright-mcp/` (gitignored) |
| `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` | 1024×1024 | Yes, iOS marketing icon |
| `public/og.png` | 1200×630 | Web share card only |
| `docs/screenshots/*-{light,dark}.png` (12 files) | 1600×1000 | No. README only, landscape desktop |

**Store screenshot sets are not committed.** `store-listing.yml` generates
them at push time with `scripts/capture-play-store-screenshots.mjs` (routes
`/`, `/learn`, `/simulate`, `/advise`, `/notes`) and uploads them as a workflow
artifact. Older sets are in the owner's Drive.

| Set | Generated size | Requirement | Gap |
|---|---|---|---|
| iPhone (`APP_IPHONE_65`) | 1242×2688 ×5 | 6.9" (1260×2736 / 1290×2796 / 1320×2868) is required **unless 6.5" is provided**; 6.5" accepts 1242×2688 (Apple screenshot specifications page, 2026-10-02) | Compliant. Optional: a native 6.9" set |
| iPad 13" (`APP_IPAD_PRO_3GEN_129`) | 2048×2732 ×5 | Required; universal app (`TARGETED_DEVICE_FAMILY = "1,2"`) | Compliant |
| Play phone | 1080×1920 ×5 | 2–8 screenshots | Compliant |
| Play 7" / 10" | 1200×1920 / 1600×2560 ×5 | Needed for tablet listing | Compliant |
| Play feature graphic | 1024×500 | 1024×500 | Compliant |
| Play icon | 512×512 | 512×512 | Compliant (generated) |

The live App Store (1.0.0) shows 5 iPhone and 5 iPad tiles
(`asc-01-home … asc-05-notes`, iTunes lookup).

**Content gap:**
- The Role-play tile is forced to the *Riley* scene, so it doesn't match the
  in-app default (R1). Once the persona order is fixed, drop the override and
  recapture all sets.
- If the R2 consent sheet ships, make sure the capture seeds consent, so the
  sheet doesn't cover tiles.
- Recapture from a build whose H1 and labels read lets-talk.

## 10. Owner open questions

1. **Paste the full 1.1.0 rejection message**: guideline numbers, the
   reviewer's text, device, and submission id. §8's ranking is provisional
   until then.
2. Was the 2026-09-22 *Cooler Heads* build the one rejected? Did Apple attach
   screenshots or name an in-app screen?
3. Approve the R1 app change: neutral persona order and default, and
   Girlfriend/Wife → Partner/Spouse? This is code, not metadata, and it needs a
   new build.
4. Approve the R2 AI-consent sheet and the R3 privacy and support links? Both
   need a new build.
5. iOS description: keep or drop the BYOK sentence (R4)? Dropping it needs an
   iOS-only description file, because the push script shares the file.
6. App Privacy: was **Crash Data** added after 2026-09-20 (R6)?
7. Check per-IP guest usage before resubmitting (R7), or give review a demo
   account with credits?
8. Remove `us.kensaur.howtotalktogirls` from the visible `/privacy` header?
9. Version: resubmit as 1.1.0 with a new build, or bump to 1.1.1? What's New
   above assumes the diff is measured against live 1.0.0.
10. Is the Play listing's live screenshot set the lets-talk capture from
    2026-09-28? The local feature graphic reads lets-talk; the live Play
    images were not fetched.

## Appendix: evidence index

| Topic | Path(s) |
|---|---|
| Name decisions | `docs/adr/0009-rename-to-cooler-heads-after-guideline-1-1.md`, `docs/adr/0010-rename-to-lets-talk.md`, `CONTEXT.md` |
| Review history, privacy labels, billing rules | `docs/store-release-checklist.md` |
| Staged listing | `distribution/listing/{en-US,ja}/*.txt`, `distribution/whatsnew/whatsnew-en-US.txt`, `distribution/review-notes-en-US.txt` |
| Gate | `scripts/listing-check.mjs:38-41` (name/brand), `:60-130` (fields, price, platform, safety, retired) |
| Push / submit | `scripts/push-store-listing.mjs`, `scripts/submit-app-store.mjs`, `.github/workflows/store-listing.yml`, `.github/workflows/build-mobile-capacitor.yml` |
| Native config | `capacitor.config.ts`, `ios/App/App/Info.plist`, `ios/App/App.xcodeproj/project.pbxproj`, `ios/App/CapApp-SPM/Package.swift`, `android/app/src/main/res/values/strings.xml` |
| Personas (R1) | `src/content/personas.ts:8-16,72-96,213-226`, `src/features/simulation/use-simulation-setup-form.ts:45-53` |
| Screenshot override (R1c) | `scripts/capture-play-store-screenshots.mjs:59-67,139-147` |
| AI relay (R2) | `supabase/functions/htttg-chat/index.ts:44-59`, `supabase/functions/_shared/langfuse.ts` |
| In-app privacy copy (R2/R3) | `src/i18n/resources/en/settings.json:85-105`, `src/features/byok/settings-privacy-card.tsx`, `src/lib/site.ts:11`, `src/app/layout.tsx:275-298` |
| BYOK steering (R4) | `src/features/byok/get-key-guide.tsx`, `src/i18n/resources/en/account.json:4,85,89`, `src/i18n/resources/en/common.json:57-58` |
| Guest caps (R7) | `supabase/migrations/20260822120000_htttg_guest_caps.sql`, `supabase/migrations/20260826130000_htttg_guest_reserve_balance.sql` |
| OTA (R9) | `src/lib/live-update.ts:32-56` |
| Sign-in / deletion | `src/features/account/sign-in-form.tsx`, `src/features/account/account-deletion.ts`, `supabase/functions/htttg-delete-account/` |
| Live checks (2026-10-02) | Play page `<title>` (en_US, ja); iTunes lookup US/JP (`How to Talk to Girls`, 1.0.0, 17+); `talk.kensaur.us` `/`, `/privacy`, `/support`, `/compare/alternatives` |
| Web sources | Apple screenshot specs: developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/. 5.1.2(i): techcrunch.com/2025/11/13/apples-new-app-review-guidelines-clamp-down-on-apps-sharing-personal-data-with-third-party-ai. Competitors: apps.apple.com/app/id6760094522 (Hard Talk Roleplay Coach), apps.apple.com/app/id6777333043 (Theseus) |
