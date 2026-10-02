# yen-yen — App Store and Google Play listing draft

| | |
| --- | --- |
| App | yen-yen (expense tracker / 家計簿) |
| Package / bundle | `app.yenyen` (Play + iOS) · ASC app id `6764548441` |
| Repo | `C:/Users/kensa/Documents/GitHub/yen-yen` (read-only for this draft) |
| Drafted | 2026-10-02 · drafting only, nothing pushed or submitted |
| Live version | iOS 1.22.15 (released ~2026-09-29) · Play listing updated 2026-09-28 · Play installs "10+" |
| Rule applied | Google Play naming is the source of truth for both stores |

Character counts are code points (`[...s].length`), produced by a scratch validator. The validator also applied the repo's own `scripts/listing-check.mjs` rules: price words in indexed fields, platform names anywhere, keyword format, and the KENSAURUS closing line. All drafted fields pass.

---

## 1. Current listing — what is live versus what is in the repo

### Exact names (verified against the live pages on 2026-10-02)

| Surface | Live value | Chars |
| --- | --- | --- |
| Google Play title, en-US | `yen-yen – Expense Tracker` (en dash U+2013) | 25 |
| Google Play title, ja-JP | `yen-yen – 家計簿・支出管理` | 18 |
| App Store name (only locale: English) | `yen-yen – Expense Tracker` | 25 |
| App Store subtitle (live) | `Track spending. No bank login.` | 30 |

The repo SSOT is `distribution/listing/<locale>/*.txt`, documented in `docs/store-listing.md` § Localized listings. It covers 5 locales: en-US, ja, th, zh-Hans and zh-Hant.

| Field | Repo value (en-US) | Repo value (ja) |
| --- | --- | --- |
| subtitle | `Where did the money go?` (23) | `そのお金、どこへ消えた？` (12) |
| keywords | `budget,spending,tracker,money,expense,kakeibo,ledger,savings,multicurrency,bills,household,journal` (98) | `家計簿,節約,支出管理,予算,お金,貯金,固定費,外貨,多通貨,家計,共有,レシート,袋分け` (46) |
| promo text | 168 chars, ends "First 100 households get full features free." | 79 chars, ends "先着100世帯はフル機能を無料で。" |
| Play short | `Log spending in seconds and see where your money goes. No bank login, no ads.` (77) | 42 chars |
| full description | 2,175 chars | 1,235 chars |
| play-title.txt | (none, so the Play title is the App Store name) | `yen-yen – 家計簿・支出管理` |

### Findings

1. **Play matches the repo.** The live en and ja Play titles, short descriptions and description openings match `distribution/listing/` exactly. All 5 locales have been live on Play since 2026-09-28 (`docs/store-listing.md` records edit `12128882623261534786`).
2. **The App Store is English-only.** The live page lists only English. The repo's ja, th, zh-Hans and zh-Hant copy has never reached iOS, because `scripts/submit-app-store.mjs` only patches locales that ASC already has. Japanese iPhone users therefore see an English listing. This is the largest gap for a Japan-first app.
3. **The subtitle has drifted.** The live value is "Track spending. No bank login." The repo (`distribution/listing/en-US/subtitle.txt`) and `release-mobile.yml` line 1693 (`--subtitle "Where did the money go?"`) both say "Where did the money go?". So the CI subtitle push has not landed. `asc-set-store-listing.mjs` runs before the version exists and skips, and `submit-app-store.mjs` `setAppInfoListing()` only patches an App Info in an editable state.
4. **No App Store keywords are pushed by anything.** `keywords.txt` is read by `listing-check.mjs` only. Neither `asc-set-store-listing.mjs` nor `submit-app-store.mjs` sends `keywords`, so whatever is live in ASC was typed by hand.
5. **The repo's keywords waste characters.** The en keywords repeat `expense` and `tracker` from the name and include price-free filler. The ja keywords repeat `家計簿` and `支出管理`, which the ja name will contain. `袋分け` (envelope budgeting) has no matching feature string in the app: there are 0 hits in `packages/shared/src/i18n/ja.ts`.
6. **The ja copy has a factual slip.** "この4分類の方法が「家計簿」です" reads wrong to a native reader. 家計簿 is the generic word; the four-bucket method is one style, attributed to 羽仁もと子 (1904).
7. **The live iOS What's New is developer text.** It comes from conventional commits (`scripts/release-notes.mjs` via git-cliff): "native bridges, offline-first sync, transfer void cascade and ExpenseIQ import…". CI also copies the English App Store text into `whatsnew-ja-JP` (`release-mobile.yml` lines 1704–1705), so there is no Japanese What's New.
8. **Some live "never" claims are contradicted by the code.** These lines are live on Play today in both en and ja, and the drafts replace them.
   - "Auto-write anything to your ledger" / 帳簿に勝手に書き込む: `supabase/functions/run-recurring` posts due recurring rules and bills nightly, and `auto-approve-recurring` sets `reviewed_at` on habitual entries.
   - "No auto-categorization": `categorize-tx` writes an AI category *suggestion*.
   - "Send spending-guilt notifications": `unusual-spend-check` (every 10 minutes) and `low-balance-check` (hourly, `low_balance` default **true**) send push alerts. They are factual rather than guilt-tripping, but the claim is not checkable.
   - The drafts keep only verifiable lines: no bank or card connection, nothing imported without your approval, no ads.
9. **The Founder Cohort numbers are stale.** The promo says "First 100 households". `docs/founder-cohort.md` was last verified 2026-07-13 with `{cap:100, granted:6, remaining:94}`. Checkout and IAP are paused (`YENYEN_CHECKOUT_PAUSED`).

---

## 2. Metadata push mechanism and credentials

Only presence, paths and names are recorded here. No secret values were read.

| Mechanism | What it can push | Credential it needs | Status |
| --- | --- | --- | --- |
| `eas.json` `submit.production` | nothing (empty `{}`) | — | No `ascApiKeyPath`, `ascAppId` or `serviceAccountKeyPath`. EAS Submit is not configured. |
| EAS Metadata (`store.config.json`) | App Store text only | EAS + ASC key | **Absent.** There is no `store.config.json` anywhere in the repo. |
| fastlane deliver / supply | — | — | **Absent.** There is no `fastlane/` directory. |
| `scripts/asc-set-store-listing.mjs` (CI: `release-mobile.yml` ~L1665–1697) | en-US only: name, subtitle, promotional text, What's New | `--key-id`, `--issuer-id`, `--key-path` (.p8) ← GH secrets `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY_P8` | Present. It usually **skips**, because no editable version exists yet when it runs (`--allow-missing`). |
| `scripts/submit-app-store.mjs` (CI, `LISTING_DIR=distribution/listing`) | Per existing ASC locale: description, subtitle, promo and What's New on the version it creates | env `APPLE_API_KEY_ID`, `APPLE_API_ISSUER_ID`, `APPLE_API_KEY_PATH`, `APP_STORE_CONNECT_APP_ID` (same GH secrets) | Present. **It never adds a locale and never sends keywords.** |
| `r0adkll/upload-google-play@v1.1.5` (CI) | Play release + "What's New" (`distribution/whatsnew/whatsnew-{en-US,ja-JP}`) | GH secret `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Present. It does not push the listing text. |
| Android Publisher API, edits → listings → commit (manual, 2026-09-28) | Play title, short and full description, all locales | **glot.it's** account-level Play service account | yen-yen's own service account gets **403**: it lacks "Manage store presence". |
| Multi-locale ASC push (port of glot.it `scripts/growth/push-apple.mjs`) | appInfoLocalizations + appStoreVersionLocalizations per locale | ASC .p8 key | **Not ported yet** (planned in `docs/store-listing.md`). |
| ASC screenshots | — | — | No API script exists. Upload goes through the ASC web UI. |

GitHub Actions secret **names** present on `kensaurus/yen-yen` (from `gh secret list`): `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_API_KEY_P8`, `APP_STORE_CONNECT_ISSUER_ID`, `APPLE_TEAM_ID`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `ANDROID_KEYSTORE_*`, `IOS_CERTIFICATE_*`, `IOS_PROVISIONING_PROFILE`, `EXPO_TOKEN`.

Local machine: `~/private_keys/` does not exist, so there is no local ASC .p8 at the path the script's usage line assumes. `secrets/` holds `yen-yen-upload.keystore` (+ `.b64`) and two notes files. It has no README and no Play service-account JSON.

**Net result:** the App Store copy can only reach ASC through the release workflow (and only for en-US plus locales already created), or by hand. Play copy needs glot.it's service account, or a Console role grant for yen-yen's own service account.

---

## 3. Feature inventory with evidence

Every claim in the drafts below traces to one of these rows. Paths are relative to `apps/mobile/` unless they start at the repo root.

| Feature | Evidence | Tier / caveat |
| --- | --- | --- |
| Hand-entered expenses, quick add | `app/(tabs)/add.tsx`, `app/transaction/new.tsx`, `components/ui/QuickAddSheet.tsx` | Free core |
| Four kakeibo types: 必要 Need · 欲しい Want · 文化 Culture · 想定外 Unexpected | `lib/kakeibo-i18n.ts`, `packages/shared/src/i18n/ja.ts` L2147–2150 | Free |
| Works offline / offline-first sync | commit `e8b2046f` "offline-first sync"; `155fd1cd` "the composer saves offline" | Free |
| No account needed (guest ledger on device) | `lib/data-adapter-guest-helpers.ts`, `lib/guest-state.ts` | Free |
| Accounts: cash, bank, card, loan; any currency; historical FX | `app/(tabs)/accounts.tsx`, `app/account/*`, `supabase/functions/refresh-fx-rates/`, `docs/mobile-activity-sync-and-fx.md` | Free |
| Budgets | `app/(tabs)/budgets.tsx`, `app/budget/*` | Free |
| Bills and subscriptions, with export to the calendar | `app/subscriptions.tsx` (imports `exportToCalendar`), `app/bill/[id].tsx`, `modules/yenyen-calendar-bridge` | Free |
| Cashflow forecast ("left to spend") | `app/cashflow.tsx` | Free |
| Recurring entries, rules, goals | `app/recurring/*`, `app/rules.tsx`, `app/goals/*` | Free |
| Credit card statement cycles and reward rules | commit `155fd1cd`; `app/rewards/index.tsx`, `app/rewards/[id].tsx` | Free |
| Settlement inbox (foreign charges waiting on the final amount) | `app/settlement/index.tsx`; ADR 0020 | Free |
| Trips, spend by currency | `app/trip/list.tsx`, `app/trip/[id].tsx`; i18n `trip.byCurrency` | Free |
| Month-end reconcile per account | `app/account/reconcile.tsx` | Free |
| Statement check (paste a page or open a CSV/TSV, Shift_JIS decoded; MyJCB page reader) | `app/account/smart-reconcile.tsx`; commits `0fd6c69e`, `5076b478`; `supabase/functions/reconcile-statement/` | Deterministic reads are free. AI paths (PDF, unknown layouts) get a few free runs, then **KENSAURUS wallet credits** (`reconcile-statement/index.ts` L25–51). The drafts do not mention PDF. |
| CSV/JSON export; CSV import from other budget apps (YNAB, Mint, Money Forward, ExpenseIQ, yen-yen JSON) | `app/exports.tsx`, `supabase/functions/export-ledger/`, `lib/data-import.ts` `detectFormat()` L1760–1800, `app/import/index.tsx` | Free. The drafts do **not** name the other apps (Guideline 2.3.7 / Play metadata policy). |
| App lock (biometric) | `components/ui/BiometricGate.tsx`, `components/ui/SecurityPanel.tsx`, `lib/biometric.ts` | Free |
| Light/dark themes | `app/settings/appearance.tsx`; `docs/screenshots/home-light.png` | Free |
| 5 UI languages (en, ja, th, zh, zh-Hant) | `packages/shared/src/i18n/index.ts` L23 `SUPPORTED_LOCALES` | — |
| Account deletion with a 14-day undo window | `supabase/migrations/0015_account_deletion_export.sql` L19, L145; `supabase/functions/account-deletion/` | The 14 days are verified. The live copy's "hard-deleted within 24 hours" depends on the purge cron cadence and was **not re-verified**, so the drafts drop it. |
| No ads / no ad SDK | `docs/store-listing.md` (checked against the app on 2026-09-19) | Carried-over claim |
| Household sharing | `app/household/*`, `gateFeature(billing,'household_members')` | **Family / Founder Cohort** |
| AI statement import (approve every row) | `app/import/*`, `lib/ai-import.ts`, gate `ai_statement_parser` | **Paid (pro)**. Wallet credits after the free window. |
| Ask (questions about the last 90 days) | `app/ask.tsx` gate `ask_anything`; i18n "Ask about your spending, savings, or habits from the last 90 days." | **Paid (pro)** |
| Receipt scan (on-device OCR: Vision on iOS, ML Kit on Android) | `modules/yenyen-receipt-ocr`, `lib/receipt-ocr.ts`, `lib/new-tx/use-new-tx-handlers.ts` L358–370, toggle `app/settings/workflow.tsx` | Opt-in. The registry says `receipt_ocr: 'pro'` (`packages/shared/src/data/billing.ts` L83), but the add-screen handler checks only the opt-in toggle, not the gate. The drafts list it under Family features. **Owner question.** |
| Home-screen widget + Quick Settings tile | `plugins/withWidgets.js`, `widgets/README.md`, `plugins/withAndroidExtras.js` | **Play copy only.** The iOS WidgetKit sources are staged but "No Xcode target compiles these yet" (`plugins/withWidgets.js` header). |
| Year in Yen recap, reflections | `app/wrapped.tsx`, `app/reflection.tsx` | Free. Not used in the copy, to save space. |
| Subscription IAP | `react-native-iap` ^15.3.1; SKUs in `docs/store-listing.md` | **Paused** (Founder Cohort). The copy states that checkout is paused. |

**Excluded on purpose:** iOS widgets and Live Activities (no compiled extension), passkeys (hidden until `EXPO_PUBLIC_PASSKEYS_ENABLED=true`), App Clip (gated on `YEN_YEN_APP_CLIP_BUNDLE`), buying AI credits in the app (`isExternalPurchaseAllowed()` returns false), bank linking (deliberately absent), and naming other apps.

### Shipped since the last release tag (`v1.22.15+ci.157`, 2026-09-28)

- `0fd6c69e` feat(reconcile): statement reconcile v3 for cards, banks and files
- `b609b24f` fix(insights): leave transfers out of top payees, categories and savings
- `5076b478` fix(reconcile): flag entries no statement bills, ambiguous aliases
- `d9102a41` fix(mobile): stop the confetti loop that overflowed the UI thread
- `084c299f` feat(accounts): flat account screen and minimal statement surfaces (ADR 0024)

These drive the "What's New" drafts below.

---

## 4. ASO research

**Primary market: Japan.** The evidence:
- the company is a Tokyo LLC;
- JPY is the first-listed price;
- the importer recognises Money Forward's Japanese CSV header;
- statement files are decoded as Shift_JIS, and there is a MyJCB page reader;
- receipt OCR is tuned for 領収書 (kanji + Latin);
- the ja Play title already carries the category words.

The English listing serves expats and the global kakeibo-curious niche.

**The Japanese market leaders link bank accounts.** マネーフォワード ME is the 2026 #1, with 2,436 linked services. The manual-entry niche (おカネレコ, シンプル家計簿) is pitched at people uneasy about registering a bank account. Shared couple budgets (OsidOri) and receipt readers (レシーピ!, Dr.Wallet, レシートスキャン) are their own clusters. yen-yen's honest wedge is: 銀行連携なし + クレカ明細の照合 + 外貨 + 4分類.

| Keyword | Locale | Placement | Why |
| --- | --- | --- | --- |
| 家計簿 | ja | name (already) | The category head term; every competitor title carries it. |
| 支出管理 | ja | name (already) | Second head term; in the Play ja title. |
| 銀行連携なし | ja | subtitle | The differentiator against Money Forward / Zaim; ranking articles single out manual-entry apps for people uneasy about bank registration. |
| 固定費 / サブスク | ja | subtitle / keywords | Subscription and bill tracking is real (`app/subscriptions.tsx`). |
| 外貨 / 多通貨 / 為替 | ja | subtitle / keywords | Historical-FX multi-currency is rare among JP manual-entry apps. |
| レシート | ja | keywords | High-intent cluster. The feature is real, but its tier is unresolved, so it is kept out of the subtitle. |
| 夫婦 / 共有 | ja | keywords | Couple-sharing is a known JP cluster; household sharing exists (Family tier). |
| クレカ / 明細 / 照合 / 締め日 / ポイント | ja | keywords | Card statement cycles, reward rules and reconcile. |
| お小遣い帳 / かけいぼ / 手入力 | ja | keywords | Manual-ledger intent and the kana variant of the head term. |
| expense tracker | en | name (already) | Head term. |
| kakeibo, budget | en | subtitle | kakeibo has a clear "no bank, mindful" niche in English (method write-ups, a dedicated "Kakeibo" iOS app). budget + tracker combine across fields. |
| no bank login | en | subtitle | 2026 English listicles are built around "expense tracker without bank login". |
| money manager, budget planner, spending | en | keywords | Apple combines words across name, subtitle and keywords, so `manager` + `planner` + `money` cover these phrases. |

**ASO tactic (vendor-reported, not from Apple docs):** AppTweak and Appfigures report that each storefront also indexes a secondary localization, and Japan is commonly listed as ja + en-US. If that holds, the en-US keywords also count in Japan, so they deliberately avoid duplicating the ja set.

Sources: [habitto 家計簿アプリ](https://www.habitto.com/blogs/kakeibo-app-osusume-muryou/), [onamae.com 2026版](https://www.onamae.com/business/article/305802/), [app-liv 条件別](https://app-liv.jp/lifestyle/finance/1549/), [arekore 共有家計簿](https://arekore.app/lifestyle/shared-household-budget-apps), [App Store JP レシートスキャン](https://apps.apple.com/jp/app/id1571273616), [Dr.Wallet](https://apps.apple.com/JP/app/id686568005), [getfinny no-bank-login 2026](https://getfinny.app/blog/best-expense-trackers-no-bank-login-2026), [Kakeibo: Save First](https://apps.apple.com/app/id6760362042), [AppTweak cross-localization](https://www.apptweak.com/en/aso-blog/how-to-benefit-from-cross-localization-on-the-app-store?format=md), [Appfigures secondary localizations](https://app.appfigures.com/resources/guides/extend-keyword-list).

No search-volume figures were available without a paid ASO tool, so the rankings above are qualitative.

---

## 5. en-US listing (draft)

### App Store

| Field | Value | Chars |
| --- | --- | --- |
| Name | `yen-yen – Expense Tracker` (unchanged; equals the Play title) | 25/30 |
| Subtitle | `Kakeibo budget, no bank login` | 29/30 |
| Keywords | `spending,money,manager,planner,ledger,savings,bills,receipt,currency,travel,household,cashflow` | 94/100 |

The keywords overlap with the name and subtitle: none.

**Promotional text** (146/170). It contains no price words. The Founder line moves into the description; see the owner questions.

```
Log a spend in seconds, tag it Need, Want, Culture or Unexpected, and see your week at a glance. Cash, cards, any currency. No bank login, no ads.
```

**What's New — next version** (438/4000):

```
Statement check, rebuilt. Paste a card statement page, or open a bank or card CSV, and yen-yen lines it up against your entries. It flags entries the statement doesn't bill and links the card payment to your bank account.

Accounts have a calmer screen: one large balance, one trend line, one Add button.

Insights now leave transfers out of top payees, categories and savings.

Fixed a celebration animation that could slow the app down.
```

**Description** (2561/4000). The App Store and Play share this text; Play adds one bullet (see below).

```
See where your money goes, without giving any app your bank login.

yen-yen is a hand-entered expense tracker built on kakeibo (家計簿), the Japanese household-ledger habit: write it down, tag it, look back at the week.

  · Log a spend in seconds: amount, payee, one tap to tag it, save. Works offline.
  · Four spending types instead of fifty categories: Need, Want, Culture, Unexpected.
  · Cash, bank, card and loan accounts in any currency, with historical exchange rates.
  · Monthly budgets, bills and subscriptions, and a forecast of what's left to spend.
  · No account needed to start. Your ledger stays on your phone until you choose to sign in.


How it works

1. Type what you spent and save. No bank connection, nothing pulled in behind your back.
2. Tag it: something you needed, something you wanted, something that feeds your mind, or something you didn't see coming.
3. At the end of the week, see your pattern on Home and decide what to change.


For cards and foreign currency

  · Statement cycles and reward rules for each credit card.
  · Paste a statement page or open a bank or card CSV, and check it line by line against your entries. Nothing is written until you confirm.
  · Foreign charges wait in a settlement inbox until the final amount posts.
  · Tag spending to a trip and see it by currency.
  · Month-end reconcile for any account.


Keep your data yours

  · CSV and JSON export, and CSV import from other budget apps.
  · App lock, light and dark themes, and five languages: English, 日本語, ไทย, 简体中文, 繁體中文.
  · Delete your account yourself in Settings, with a 14-day undo window.
  · No ads. We don't sell your data.


Family features (Founder Cohort)

  · Share a household ledger with a partner or roommate.
  · AI-assisted statement import: you approve every row, nothing auto-saves.
  · Ask: questions about your last 90 days of spending.
  · Receipt scan: photograph a receipt and the amount and payee fill in, read on your phone.

Checkout is paused while we grow; early households get Family features through the Founder Cohort. The solo ledger is complete either way.


What yen-yen will never do

  · Connect to your bank or card accounts.
  · Import anything without you approving it.
  · Show ads.


Privacy policy: https://kensaur.us/yen-yen/privacy
Terms: https://kensaur.us/yen-yen/terms
Account deletion: https://kensaur.us/yen-yen/account/delete

Made by kensaurus LLC in Tokyo. Bugs and questions: kensaurus@gmail.com

Part of KENSAURUS — small apps, no sign-up wall. One optional account works in all of them.
```

### Google Play

| Field | Value | Chars |
| --- | --- | --- |
| Title | `yen-yen – Expense Tracker` (unchanged, live) | 25/30 |
| Short description | `Kakeibo budget app: log spending in seconds, see where it goes. No bank login.` | 78/80 |
| Full description | The description above, with one extra bullet after "No account needed…" (below) | 2649/4000 |

Play-only bullet. It is a widget claim that is true on Android only; it does not name the platform.

```
  · Home-screen widget with your balance and a one-tap add, plus a Quick Settings tile.
```

---

## 6. ja listing (draft)

### App Store

| Field | Value | Chars |
| --- | --- | --- |
| Name | `yen-yen – 家計簿・支出管理` (equals the live ja Play title) | 18/30 |
| Subtitle | `銀行連携なし｜予算・固定費・外貨も` | 17/30 |
| Keywords | `かけいぼ,節約,貯金,お小遣い帳,出費,収支,レシート,多通貨,為替,旅行,夫婦,共有,クレカ,明細,照合,サブスク,手入力,オフライン,記録,口座,ポイント,締め日` | 83/100 |

The keywords overlap with the name and subtitle: none. 家計簿, 支出管理, 予算, 固定費, 外貨 and 銀行連携 are already indexed from the name and subtitle. 袋分け was dropped because no feature matches it.

**Promotional text** (70/170):

```
使った分を数秒で記録して、必要・欲しい・文化・想定外の4つに分けるだけ。現金もカードも外貨も、ひとつの家計簿で。銀行ログイン不要、広告なし。
```

**What's New — next version** (218/4000):

```
明細の照合を作り直しました。カード明細のページを貼り付けるか、銀行・カードの CSV を開くと、記録と1行ずつ突き合わせます。明細に載っていない記録を知らせ、銀行からのカード引き落としも紐づけます。

口座画面を整理しました。残高を大きくひとつ、推移の線をひとつ、追加ボタンをひとつ。

分析の「よく使う支払先・カテゴリ・貯蓄」から、口座間の振替を除外しました。

お祝いのアニメーションでアプリが重くなることがある問題を修正しました。
```

**Description** (1264/4000). This is written for Japanese readers, not translated from the English.

```
銀行ログインを渡さずに、お金の行き先がわかる家計簿です。

yen-yen は手入力の家計簿アプリ。書いて、分けて、週の終わりに振り返る。昔ながらの家計簿の習慣を、そのままスマホで続けられます。

  · 金額と支払先を入れて、ワンタップで分類して保存。数秒で終わり、オフラインでも記録できます。
  · 分類は「必要・欲しい・文化・想定外」の4つだけ。細かい費目で迷いません。
  · 現金・銀行・クレジットカード・ローンの口座を、どの通貨でも。過去の為替レートで基準通貨に換算します。
  · 月の予算、固定費やサブスクの管理、あといくら使えるかの予測。
  · アカウント登録なしで始められます。サインインするまで、データは端末の中だけです。


クレカと外貨に強い

  · カードごとの締め日と、ポイント還元のルール。
  · カードや銀行の明細ページを貼り付けるか CSV を開いて、記録と1行ずつ照合。確定するまで何も書き込みません。Shift_JIS の CSV もそのまま読めます。
  · 海外での利用は、金額が確定するまで「精算待ち」でまとめて管理。
  · 旅行ごとに支出をまとめて、通貨別に確認。
  · 口座ごとの月末の残高照合。


データはあなたのもの

  · CSV / JSON でエクスポート。ほかの家計簿アプリの CSV も取り込めます。
  · アプリロック、ライト / ダークテーマ、5言語（日本語・English・ไทย・简体中文・繁體中文）。
  · アカウント削除は設定から自分で。14日間は取り消せます。
  · 広告なし。データを売ることもありません。


ファミリー機能（ファウンダー・コホート）

  · 家計簿をパートナーや同居人と共有。
  · AI による明細の取り込み。一行ずつあなたが承認し、勝手には保存しません。
  · Ask：直近90日の支出について質問できます。
  · レシート読み取り：撮影すると、金額と支払先を端末上で読み取ります。

購入の受付は一時停止中で、早い時期に登録した世帯にファミリー機能を提供しています。ひとり用の家計簿は、どちらの場合もすべて使えます。


yen-yen がしないこと

  · 銀行やカードの口座に接続すること。
  · あなたの承認なしにデータを取り込むこと。
  · 広告を表示すること。


プライバシーポリシー: https://kensaur.us/yen-yen/privacy
利用規約: https://kensaur.us/yen-yen/terms
アカウント削除: https://kensaur.us/yen-yen/account/delete

東京の kensaurus LLC が作りました。バグや質問は kensaurus@gmail.com へ。

KENSAURUS のアプリです — 小さなアプリたち、登録の壁なし。任意のアカウントひとつで、すべてのアプリを使えます。
```

### Google Play

| Field | Value | Chars |
| --- | --- | --- |
| Title | `yen-yen – 家計簿・支出管理` (unchanged, live) | 18/30 |
| Short description | `手入力で続く家計簿。数秒で記録して、4つの分類でお金の行き先がわかる。銀行連携なし・広告なし。` | 47/80 |
| Full description | The description above, plus one bullet after 「アカウント登録なしで…」 | 1311/4000 |

Play-only bullet:

```
  · ホーム画面ウィジェットで残高を確認してワンタップで記録。クイック設定タイルにも対応。
```

---

## 7. Screenshot inventory versus requirements

Dimensions were read from the PNG headers (IHDR). Everything is in `yen-yen/docs/store-listing-assets/`. `ios.supportsTablet: true` (`app.config.ts` L136), so iPad 13" is required.

| Tier | Required | In repo | Count | Last commit | Dimension check | Content check |
| --- | --- | --- | --- | --- | --- | --- |
| iPhone 6.9" | 1320×2868 or 1290×2796 | `appstore/screenshots-iphone-6-9/` 1320×2868 | 10 | 2026-06-30 | ✅ | ❌ It is an **Android emulator capture**: Android status bar and gesture bar, a bright green "BETA · Report a bug · Feature idea" band, and a floating gear over the header. That is a risk under Guidelines 2.3.10 (other-platform imagery) and 2.3.3 (not the app as it runs on the device). |
| iPhone 6.7" / 6.5" | optional (scaled) | 1290×2796 / 1242×2688 | 10 + 10 | 2026-06-30 | ✅ | Same source as 6.9". `docs/store-listing.md` says 6.5" is what was uploaded to ASC. |
| iPhone 5.5" legacy | not needed | `appstore/screenshots/` 1242×2208 | 8 | — | — | Marketing mockups |
| iPad 13" | 2064×2752 or 2048×2732 | `appstore/screenshots-ipad-13/` 2064×2752 | 10 | 2026-06-30 | ✅ | ❌ A phone capture cover-cropped to the iPad ratio: the top of the screen is cut off and it does not show an iPad layout. Real merchant names are visible (Amazon, Taobao). |
| App Store icon | 1024×1024 | `appstore/icon-1024.png` | 1 | — | ✅ | — |
| Play phone (2–8) | 9:16 or 16:9, 320–3840 px | `play/screenshots/` 1242×2208 | 8 | 2026-05-05 | ✅ | ⚠️ Stylised marketing mockups (tilted card, "MIO & YOU"), not app UI. They predate the June nav (Home · Activity · + · Accounts · Plan) and ADR 0024. |
| Play 7" tablet | optional | `play/screenshots-tablet7/` 1080×1920 | 8 | — | ✅ | Mockups |
| Play 10" tablet | optional | `play/screenshots-tablet10/` 1620×2880 | 8 | — | ✅ | Mockups |
| Play feature graphic | 1024×500 | `play/feature-1024x500.png` | 1 | 2026-04-30 | ✅ | ✅ Clean: "yen-yen · 家計簿 — the budget app that won't ask for your bank login." |
| Play icon | 512×512 | `play/icon-512.png` | 1 | — | ✅ | — |

**Gaps**

1. Recapture the iOS sets on an iOS Simulator (6.9" and iPad 13"), signed in, with the beta band and dev chrome off. The `ios-simulator-smoke.yml` workflow and `.maestro/store-screenshots-asc.yaml` already exist.
2. The screenshots predate the 2026-10 accounts redesign (ADR 0024) and statement reconcile v3. Add a reconcile panel: it is the newest differentiator.
3. **There are no Japanese screenshots on either store.** The app ships ja UI strings. Capture a ja set: on Play it can be attached to the ja-JP listing, and on iOS to a new ja localization.
4. Replace the Play phone mockups with real UI (Android captures are fine there).
5. Check whether ASC requires screenshots per new localization. `submit-app-store.mjs` says that "adding one needs screenshots", but ASC normally falls back to the primary-language screenshots. Verify in ASC before treating it as a blocker.

---

## 8. Owner open questions

1. **ja App Store name.** Should it become `yen-yen – 家計簿・支出管理` to match Play (per the "Play is the source of truth" rule)? That conflicts with `APP_NAME` in `scripts/listing-check.mjs` and with `docs/store-listing.md` ("The App Store name stays `yen-yen – Expense Tracker` in every locale"). Both would need updating.
2. **Add the ja localization in ASC** (and th, zh-Hans, zh-Hant)? Choose either a one-time manual add or porting glot.it's `push-apple.mjs`, which also covers keywords. Nothing in this repo pushes keywords today.
3. **Subtitle source of truth.** The live value is "Track spending. No bank login.", and the repo and CI say "Where did the money go?". The draft proposes "Kakeibo budget, no bank login". Changing it means updating `distribution/listing/en-US/subtitle.txt` and `release-mobile.yml` `--subtitle` together, or `listing:check` fails.
4. **Promo text and the Founder Cohort.** The draft drops "First 100 households get full features free" (a price word, and the count is stale: 94 spots were left at 2026-07-13). If you keep the hook, `scripts/store-promo.txt` must change in lockstep with `promo-text.txt`. What is the current `remaining` count?
5. **Receipt scan tier.** `billing.ts` says `receipt_ocr: 'pro'`, but `use-new-tx-handlers.ts` runs OCR for anyone who turns on Settings → Scan receipts. Is it free or Family? The answer decides whether it can move into the free bullet list and the ja subtitle (レシート読み取り is a strong JP query).
6. **Naming import sources.** Can the description say "Import from YNAB, Mint, Money Forward or ExpenseIQ CSV"? Can it name the MyJCB statement page? It is accurate, but it is a trademark/2.3.7 judgement call. The draft keeps both generic.
7. **"Hard-deleted within 24 hours"** is in the live copy but was not re-verified against the purge cron, so the draft omits it. Keep it or drop it?
8. **What's New pipeline.** `release-notes.mjs` regenerates What's New from commits and copies the English into ja-JP. Hand-written text like the drafts above is overwritten unless the source changes. Possible changes are a curated `distribution/release-notes/*.txt` override or a ja file.
9. **Play service account.** Should yen-yen's own Play service account get the "Manage store presence" permission, so listing pushes stop depending on glot.it's account?
10. **Push the corrected "never" list soon.** The live Play copy (all 5 locales) and `distribution/listing/*/full-description.txt` still say "Auto-write anything to your ledger" and "Send spending-guilt notifications". The code contradicts both (finding 8). The th, zh-Hans and zh-Hant files need the same edit.

---

### Appendix — validation run

The scratch validator (session scratchpad, not in the repo) applied `listing-check.mjs`'s price and platform patterns, keyword format, keyword overlap with the name and subtitle, and the closing line. The final run printed `ALL OK`. Counts are code points.

| Locale | Name | Subtitle | Promo | Keywords | What's New | Play title | Play short | Description | Play full |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| en-US | 25 | 29 | 146 | 94 | 438 | 25 | 78 | 2561 | 2649 |
| ja | 18 | 17 | 70 | 83 | 218 | 18 | 47 | 1264 | 1311 |
