# help her take photo: store listing draft (App Store + Google Play)

> **Status: draft only, as of 2026-10-02.** Nothing was pushed to App Store Connect or Play Console.
>
> **Evidence base.** Copy and code facts come from `git show origin/main:<path>` in
> `C:/Users/kensa/Documents/GitHub/help-her-take-photo`, at origin/main `f03cf0a`, committed 2026-09-28.
> - That is the last-fetched ref. No fetch was run, so newer remote commits may exist.
> - The local checkout is on `feat/housekeep-backlog-close`, 38 commits behind origin/main, with uncommitted edits from another agent. It was **not** used as a source for copy.
>
> **Live listings** were read on 2026-10-02 from the public pages: `play.google.com/store/apps/details?id=com.kensaurus.helphertakephoto` (en_US and ja) and `apps.apple.com/us/app/id6762513666`.

## 1. Identity

| Field | Value | Source |
| --- | --- | --- |
| Google Play title (live, exact) | `help her take photo – Pose Cam`, 30 chars. The dash is an en dash (U+2013) with a space on each side. | Live Play page `itemprop="name"`, same on en_US and ja. Also `distribution/listing/*/name.txt`. |
| Play package | `com.kensaurus.helphertakephoto` | `app.config.ts` `android.package`; `release-mobile.yml` `packageName` |
| iOS bundle id | `com.kensaurus.helphertakephoto` | `app.config.ts` `ios.bundleIdentifier` |
| App Store app id | `6762513666` | `eas.json` `submit.production.ios.ascAppId`; public URL |
| App Store name (live) | `Help Her Take Photo` | Live App Store page |
| App Store subtitle (live) | `Two phones, one perfect photo`, 29 chars | Live App Store page lockup |
| Live versions | iOS 1.12.1, released around 2026-09-30 (the App Store page says "2 days ago"). Play updated 2026-09-28, which matches the 1.12.3 build. | App Store version history; Play "Updated on" |
| Home-screen label | `help her take photo` since 1.12.3. Android has shipped it; iOS gets it with the next native build. | `app.config.ts` `name` (origin/main); BACKLOG BL-032 |
| Marketing version on main | `1.12.3` | `app.config.ts` `version` |
| Supports iPad | **Yes**: `ios.supportsTablet: true` | `app.config.ts` |
| UI locales | en, th, zh, ja (`export type Language = 'en' \| 'th' \| 'zh' \| 'ja'`) | `src/i18n/translations.ts` |
| Store locales today | **Play:** en-US, th, zh-CN and ja-JP (all four, since 2026-09-28). **App Store:** **en-US only.** The live page lists English only. | `docs/store-listing.md` → "What pushes these folders"; live App Store page |

## 2. Current listing: what exists and what is live

### 2.1 Repo source of truth

Since 2026-09-19 the reviewer-facing copy lives in **`distribution/listing/<locale>/`** on origin/main, one folder per locale: `en-US`, `ja`, `th`, `zh-Hans`. Each folder holds:
- `name.txt`
- `subtitle.txt`
- `keywords.txt`
- `promo-text.txt`
- `short-description.txt`
- `full-description.txt`

`npm run listing:check` (`scripts/listing-check.mjs`) runs in the required PR gate. It enforces:
- the banned words in four languages;
- the Guideline 2.3.10 platform names;
- length limits, counted in code points;
- price words in indexed fields;
- the `help her take photo – ` name prefix;
- the localized KENSAURUS closing line.

`docs/store-listing.md` still holds an older ★-variant of the Play copy and old App Store blocks, but those are labeled as what was live earlier. The `.txt` files supersede them.

### 2.2 Live App Store description (1.12.1) does not match the app. This is the top risk.

The live App Store description is older copy that pre-dates the listing SSOT. It contains claims the code contradicts:

| Live App Store claim | What the code says | Risk |
| --- | --- | --- |
| "Photos stay on your phone. We never upload your images to a server." | Photos upload to the cloud gallery: `cloudApi.photo.upload` in `app/camera.tsx:545`, `app/gallery.tsx:480,538` and `src/services/uploadQueue.ts:79`. The privacy label declares **User Content (Photos), collected**. | Guideline 2.3 (accurate metadata) and 5.1.1. It contradicts the app's own privacy nutrition label. |
| "Open source on GitHub. Audit the code yourself." | `gh repo view kensaurus/help-her-take-photo` returns `"visibility":"PRIVATE"`. | False claim (2.3). |
| "Send 'higher', 'lower', 'closer', 'tilt left'… or types a quick note" | The viewer sends left, right, up, down, closer, back and "Perfect! Take it!". There is no "tilt" command and no free-text note. | Inaccurate feature (2.3.1). |
| "Photo saves to the camera phone's library." | Photos land in the shared gallery on both phones. | Inaccurate. |
| "email support@kensaur.us" | The store support inbox in `docs/store-listing.md` is `kensaurus@gmail.com`. | Owner check needed. |

The description is stored per App Store **version**, so it stays wrong until the next iOS version ships. `scripts/submit-app-store.mjs` then pushes `distribution/listing/en-US/full-description.txt`.

The current repo `.txt` copy is mostly accurate. Two problems remain:
- "pan, tilt, zoom, capture" is not what the director sends.
- The ja copy repeats the same error ("パン、チルト、ズーム、撮影").

### 2.3 Repo `.txt` values today (origin/main)

| Field | en-US (count) | ja (count) |
| --- | --- | --- |
| name | `help her take photo – Pose Cam` (30) | same (30) |
| subtitle | `Direct her pose, nail the shot` (30). Owner decision, 2026-09-28. | `ポーズを指示して、最高の一枚を` (15) |
| keywords | `couple,partner,remote,camera,guide,live,framing,viewfinder,director,shoot,gallery,wedding,selfie` (96) | `写真,カメラ,カップル,彼氏,彼女,ポーズ,遠隔,ライブ,構図,ファインダー,共有,アルバム,結婚式,撮影` (53) |
| promo text | 151 chars | 73 chars |
| Play short description | `See her camera live on your phone. Guide the pose, get the shot you both want.` (78). This is live on Play. | `相手のカメラ画面を自分のスマホでライブ表示。ポーズを指示して、狙い通りの一枚を。` (40). This is live on Play. |
| full description | 866 chars. This is live on Play en-US. | 429 chars. This is live on Play ja-JP. |

## 3. Metadata push mechanism and credentials (presence only)

| Mechanism | Pushes listing text? | Needs | Present? |
| --- | --- | --- | --- |
| **EAS Submit** (`eas.json` `submit.production`) | **No.** It uploads binaries only. | iOS: `ascApiKeyPath ./secrets/asc-api-key.p8` plus key id, issuer id and team id fields. Android: `serviceAccountKeyPath ./secrets/google-play-service-account.json`. | **Both files are absent locally.** `secrets/` holds only `README.md`. |
| **EAS Metadata** (`eas metadata:push` + `store.config.json`) | Could push App Store text. | `store.config.json` | **Not set up.** There is no `store.config.json` and no fastlane. |
| **`scripts/submit-app-store.mjs`** (ASC API; runs in `release-mobile.yml` line ~1408 on iOS releases) | **Yes, for App Store.** It sets name and subtitle on the editable appInfo, and promotional text, description, keywords and whatsNew on the new version. It only touches locales that already exist in ASC, which today is en-US. | Env `APPLE_API_KEY_ID`, `APPLE_API_ISSUER_ID`, `APPLE_API_KEY_PATH`, `APP_STORE_CONNECT_APP_ID`, `APP_VERSION`, `BUILD_NUMBER`, `WHATSNEW_DIR`, with optional `APPLE_AUTO_SUBMIT_PRODUCTION` and `APPLE_RELEASE_TYPE`. | **CI: yes.** Secret names exist: `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER_ID`, `ASC_API_KEY_P8_BASE64`, `APPLE_AUTO_SUBMIT_PRODUCTION`. **Locally: no `.p8`.** |
| **`scripts/push-apple-promo.mjs`** | Promotional text only, written to the live (`READY_FOR_SALE`) version. | `APPLE_API_KEY_ID`, `APPLE_API_ISSUER_ID`, `APPLE_API_KEY_PATH`, `APP_STORE_CONNECT_APP_ID` | CI secrets exist. Locally there is no `.p8`. |
| **`scripts/push-play-listing.mjs`** (Play Developer API edits; dry run by default, `--apply`, `--add-locales`, `--images`) | **Yes, for Play:** title, short description, full description, and with `--images` the icon and feature graphic. It is **not** wired into CI and is run by hand. | `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (a path) | CI secret `GOOGLE_PLAY_SERVICE_ACCOUNT_BASE64` exists. **There is no local JSON.** |
| `r0adkll/upload-google-play@v1.1.5` in `release-mobile.yml` | Release notes only (`whatsNewDirectory: distribution/whatsnew`), and only en-US. | `GOOGLE_PLAY_SERVICE_ACCOUNT_BASE64` | Present in CI. |
| Screenshots | **Nothing uploads them** (BL-032). Upload by hand in each console. | none | none |

GitHub secret **names** were read with `gh secret list`, which prints no values. `google-services.json` exists at the repo root and was not read.

**Gap.** To push from this machine, the owner must restore two files from the Drive backup named in `secrets/README.md`:
- `secrets/asc-api-key.p8`
- `secrets/google-play-service-account.json`

Otherwise, run the push through CI.

## 4. Feature inventory: what the copy may claim

| Feature | Evidence (origin/main) |
| --- | --- |
| Two-phone live view: one person shoots, the other directs | `app/camera.tsx`, `app/viewer.tsx`; i18n `home.photographer` / `home.director` |
| Director commands: left, right, up, down, closer, back, and "Perfect! Take it!" | i18n `viewer.directions.*`, `viewer.takePhoto` |
| Tap the live view to point at a spot | i18n `viewer.markHint` ("Tap the viewfinder to point"); CHANGELOG 1.11.0 |
| Reactions: Love it, Retake, Perfect | i18n `viewer.reactionLove/Retake/Perfect` |
| Pose mode with **34** curated poses in 5 categories (couple 10, solo 8, scenic 6, fun 5, closeup 3), sent with one tap | `src/data/poses.ts`; `src/components/PoseCoachDeck.tsx`; i18n `viewer.modePoses` |
| Flash and flip camera | i18n `viewer.flash`, `viewer.flip` |
| Pairing by code (6-digit CSPRNG; the server accepts 4–6), QR scan, or share link | `app/pairing.tsx`, `app/scanQR.tsx`, `src/components/PairingQRCode.tsx`, `src/lib/@_lib-README.md`, `supabase/functions/_shared/validation.ts` |
| Shared gallery on both phones, stored privately (only the pair can open it) | `app/gallery.tsx`, `src/services/uploadQueue.ts`; CHANGELOG 1.9.0 |
| Albums | `app/albums.tsx`, `app/albums/[id].tsx` |
| Monthly recap / memory book (days together, photos this month, share) | `app/recap.tsx`, `src/components/MemoryRecapCard.tsx`; i18n `recap.*` |
| Friends | `app/friends.tsx` |
| AI photo analysis (composition and lighting): 3 free a day, then wallet credits | `src/components/gallery/PhotoViewerModal.tsx` (`aiAnalysis`, `analyzeHint`); commit `4a47d83`. **Not used in the copy; see the owner questions.** |
| No account needed; delete account and data from Settings | i18n `home.freePromise`; CHANGELOG 1.5.2 |
| Optional KENSAURUS account sign-in and passport stamps | CHANGELOG 1.12.0; `src/services/accountUpgrade.ts` |
| Light and dark themes; 4 languages | CHANGELOG 1.0.0 / 1.10.0; `translations.ts` |
| **Not shipped. Never claim:** widgets, Live Activity, App Intents | `widgets/README.md` ("scaffold / flags only"); `src/config/featureFlags.ts` defaults are off |

Recent changes in the last 60 days on origin/main:
- **1.11.0** (09-13): pair-first first run, and tap-to-mark for the director.
- **1.12.0** (09-22): KENSAURUS account claim and passport, and full Settings translations.
- **1.12.1** (09-26): Show-code fix on first launch.
- **1.12.2** (09-28): new icon and the store name `help her take photo – Pose Cam`.
- **1.12.3** (09-28): home-screen label `help her take photo`.
- **Unreleased** (`7df16fb`, `[skip release]`): lowercase home and splash wordmark.

## 5. ASO keyword research

**Method.** No search-volume tool was used, and Firecrawl was avoided. The terms below are reasoned from:
- competitor names and subtitles found by WebSearch;
- the "similar apps" lockups on the live App Store page;
- Japanese how-to articles about couple photos.

Treat it as a starting hypothesis. Measure it in App Store Connect → App Analytics → Sources: Search, and in Play Console → Store performance → Search terms.

| # | Locale | Term | Why | Placement |
| --- | --- | --- | --- | --- |
| 1 | en | pose / pose ideas / pose guide | The category's head term. Competitors include "Photo Poses: Pose Ideas Guide", "Poze: Pose Camera" and "PoseCam: Pose Guide Camera AI". "pose" is in the name, so add `ideas` and `guide` to the keywords to form the phrases. | name + keywords |
| 2 | en | remote camera / remote preview | The closest functional rivals use it: TeleShot "Remote Camera", Snapshot "Remote Preview, Better Shots", SayCheese "Two iPhones, Wireless Shutter". | keywords (or alt subtitle) |
| 3 | en | couple / partner | The core audience. Gender-neutral and high intent. | keywords (or alt subtitle) |
| 4 | en | boyfriend / girlfriend | Matches "instagram boyfriend" / "boyfriend can't take photos" searches. Both genders are included on purpose, so the set doesn't read as one-directional. | keywords |
| 5 | en | live / viewfinder / preview | Describes the mechanism and matches "live preview" queries. | keywords |
| 6 | en | wedding / travel | Occasions named in the copy. | keywords |
| 7 | ja | カップル 写真 / ふたり | The main Japanese query for this need. The name is English in every locale, so **the ja subtitle and keywords carry all Japanese search.** | ja subtitle + keywords |
| 8 | ja | 彼氏 / 彼女 / 恋人 / 夫婦 | "彼氏 写真 下手" and "彼女 写真 撮り方" are common pain-point searches. The Japanese competitors "とって - パパママ/彼氏彼女の写真とって問題を解決" and "coyattetotte 理想の構図カメラ" target exactly this. | ja keywords |
| 9 | ja | ポーズ / 構図 / 撮り方 / 映え | Pose, composition and how-to queries. 構図 is the competitor coyattetotte's main word. | ja keywords |
| 10 | ja | リモート / 遠隔 / ライブ / 指示 / シャッター | Describe the mechanism; this is how a Japanese user describes "remote camera". | ja subtitle + keywords |

**Inclusivity and review risks**

- **The brand is gendered** ("help *her* take photo"), and the owner decided it on 2026-09-28. The owner's subtitle `Direct her pose, nail the shot` and the Play short description `See her camera live…` add a second and third "her". Two reasons to offer a neutral alternative:
  - **Inclusion.** The body copy already says "partner" and "both of you". The friends screen and the "More than couples" screenshot show it isn't only for couples.
  - **ASO.** "her" and "pose" repeat words from the name. Only *direct, nail* and *shot* add indexable words.
  - The alternatives are shown as owner choices in §6.
- **"Pose Cam" name clash.** Live App Store apps include "PoseCam: Pose Guide Camera AI" (id6780748437) and "SnapPose: Pose Cam Template". It's a generic descriptor after an en dash, so it is likely fine. Still, it's a possible confusion or trademark complaint vector. Owner awareness only; it doesn't block.
- **Banned words.** The draft has none of anonymous, random or stranger(s), or 匿名, ランダム, 見知らぬ. The old App Store copy said "hand the camera to a stranger" and is replaced. There are no platform names (2.3.10).
- **No other app names in keywords** (Guideline 2.3.7). "インスタ映え" was considered and dropped because it names Instagram; the generic `映え` is used instead.
- **Price words.** "free" appears only in the description, which `listing:check` treats as a warning. It is not in the name, subtitle or keywords (2.3.7).

## 6. en-US listing (proposed)

All counts are Unicode code points, computed with `[...str].length` in node. The draft was also run through a scratch copy of origin/main's `scripts/listing-check.mjs`:
- **Proposed set** (owner subtitle): `4 locale(s) OK`, with the same 4 price warnings in the description as on main.
- **Alt set:** also `OK`.

### App Store

| Field | Live today | Proposed | Count / limit |
| --- | --- | --- | --- |
| Name | `Help Her Take Photo` | `help her take photo – Pose Cam`. This is the Play title, already in `name.txt`, and ships with the next iOS version. | 30 / 30 |
| Subtitle (owner baseline) | `Two phones, one perfect photo` (29) | `Direct her pose, nail the shot` | 30 / 30 |
| Subtitle (**alt, owner choice**) | | `Live remote camera for couples`. Gender-neutral and adds 4 new indexable words. | 30 / 30 |
| Promotional text | blank. 1.12.1 shipped without it (BL-033). | `Stop the “let me see… delete it” loop. Your phone shows your partner’s camera live, so you can guide the pose and framing, then snap the shot together.` Unchanged from the repo. | 151 / 170 |
| Keywords (with the owner subtitle) | not visible | `guide,ideas,couple,partner,boyfriend,girlfriend,remote,camera,live,preview,viewfinder,wedding,travel` | 100 / 100 |
| Keywords (with the **alt** subtitle) | | `guide,ideas,direct,partner,boyfriend,girlfriend,preview,viewfinder,framing,shutter,wedding,travel` | 97 / 100 |

Neither keyword set repeats a word from the name or its subtitle, which was checked by script. Compared with the repo, the changes are:
- Dropped `director` and `shoot`, which are near-duplicates of the subtitle's direct/shot.
- Dropped `gallery`, which is generic.
- Dropped `selfie`, which is not what the app does.
- Dropped `framing` in the owner set, for space.
- Added `ideas`, `boyfriend`, `girlfriend`, `preview` and `travel`.

**Description** (1496 / 4000). It replaces the live text, and it is also the Play full description because one file serves both stores:

```
Stop taking ten photos to get one. Your phone shows your partner’s camera live, so you can guide the pose and the framing until the shot is right.

One of you holds the camera. The other watches the live view on their own phone and directs: left, right, up, down, closer, back, then “Perfect! Take it!”

WHAT YOU GET
• The camera’s live view, on your own phone
• Tap-to-send directions: left, right, up, down, closer, back
• Tap the live view to point at the exact spot you mean
• 30+ pose ideas you can send with one tap
• Quick reactions: Love it, Retake, Perfect
• Every shot lands in a private gallery you both share
• Albums you build together, plus a monthly recap
• Pair with a short code, a QR scan or an invite link
• English, Thai, Chinese and Japanese

HOW IT WORKS
1. Open the app on both phones and pair with a short code
2. One of you holds the camera; the other watches the live view and directs
3. Tap capture, and the photo lands in your shared gallery

BUILT FOR
• Couples on dates and trips
• Friends at weddings, concerts and get-togethers
• Anyone who has handed over their phone and got back a photo with their head cut off

FREE AND PRIVATE
Pairing and live capture are free, and no account is needed. Live video goes phone to phone when possible. Your photos are stored privately: only you and your partner can open them. No ads, no tracking, no third-party data sales, and you can delete everything anytime from Settings.

Part of KENSAURUS — small apps, no sign-up wall.
```

Changes from the repo's 866-char text:
- The real direction set replaces "pan, tilt, zoom, capture".
- Added tap-to-point, reactions, albums and recap, the QR or invite-link pairing, and the "private, only you two" storage line (CHANGELOG 1.9.0).
- Added a BUILT FOR block without "stranger".
- No pairing-time number. The "Pair in 6 seconds" screenshot band and the CHANGELOG's "about 20 seconds" disagree, so the copy states neither.

**What's New, next iOS version** (264 / 4000). It covers 1.12.2, 1.12.3 and the unreleased wordmark, because iOS jumps from 1.12.1:

```
A fresh new look and a new name.

• New app icon
• The app is now called help her take photo – Pose Cam, and your home screen label reads help her take photo
• The home and launch screens show the new lowercase wordmark
• Behind-the-scenes reliability improvements
```

> **Caveat.** `scripts/extract-changelog.mjs` emits only `CHANGELOG[0]` from `src/config/build.ts`, which is 1.12.3 today. Left alone, iOS users get only the 1.12.3 lines, and the icon and name change from 1.12.2 is missing. Before cutting iOS, either:
> - put a combined entry at the top of `CHANGELOG`, or
> - paste this text into `distribution/appstore/whatsnew-en-US` after extraction.

### Google Play

| Field | Live today | Proposed | Count / limit |
| --- | --- | --- | --- |
| Title | `help her take photo – Pose Cam` | unchanged | 30 / 30 |
| Short description (owner baseline) | `See her camera live on your phone. Guide the pose, get the shot you both want.` | unchanged | 78 / 80 |
| Short description (**alt, owner choice**) | | `See your partner’s camera live. Guide the pose, get the shot you both want.` | 75 / 80 |
| Full description | the repo's 866-char text | the 1496-char description above | 1496 / 4000 |
| What's New, next Play release (only the wordmark is user-visible since 1.12.3) | | `The home and launch screens now show the new lowercase help her take photo wordmark, to match the new icon and store name. Plus behind-the-scenes reliability improvements.` | 171 / 500 |

## 7. ja listing (proposed)

To appear on the Japanese App Store, **ja must first be added as a localization in App Store Connect**. Only en-US exists today. `submit-app-store.mjs` fills only existing locales.

### App Store (ja)

| Field | Repo today | Proposed | Count / limit |
| --- | --- | --- | --- |
| Name | `help her take photo – Pose Cam` | unchanged. The name is the same in every locale, and `listing:check` enforces the prefix. | 30 / 30 |
| Subtitle | `ポーズを指示して、最高の一枚を` (15) | `カップル写真をライブで指示できるリモートカメラ` | 23 / 30 |
| Promotional text | 73 | `「ちょっと見せて…消して」の繰り返しはもう終わり。相手のカメラ画面を自分のスマホでライブで見ながら、ポーズと構図を指示して、ふたりで最高の一枚を。` | 73 / 170 |
| Keywords | 53 | `彼氏,彼女,ポーズ,構図,撮り方,撮影,ファインダー,プレビュー,共有,アルバム,結婚式,旅行,デート,シャッター,遠隔,ふたり,友達,映え,上手,恋人,夫婦,ペア,記念日,思い出,スナップ` | 95 / 100 (237 UTF-8 bytes) |

The subtitle now indexes カップル, 写真, ライブ, 指示, リモート and カメラ. None of those repeat in the keywords; a script checked this.

Apple has counted the keyword limit as 100 **characters** in every language since 2013, when it moved away from 100 bytes. The byte count is shown only so the owner can check it if ASC ever disagrees.

**Description** (731 / 4000). It also serves as the Play ja-JP full description:

```
10枚撮って1枚だけ残す、はもう終わり。相手のカメラ画面が自分のスマホにライブで映るから、ポーズも構図も、決まるまで指示できます。

ひとりがカメラを持つ「撮る人」、もうひとりは自分のスマホでライブ映像を見る「ディレクター」。左・右・上・下・近く・後ろと指示して、最後は「完璧！撮って！」。

できること
• カメラのライブ映像を自分のスマホで確認
• タップで指示：左・右・上・下・近く・後ろ
• ライブ映像をタップして、狙いの位置を指し示す
• 30種類以上のポーズ案をワンタップで送信
• ひとことリアクション：大好き・撮り直し・完璧
• 撮った写真は、ふたりだけが開ける共有アルバムへ
• ふたりで作るアルバムと、毎月の振り返り
• ペアリングは短いコード、QRスキャン、招待リンクで
• 日本語・英語・タイ語・中国語に対応

使い方
1. 両方のスマホでアプリを開き、短いペアリングコードでつなぐ
2. ひとりがカメラを持つ撮る人、もうひとりがライブ映像を見るディレクター
3. 撮影をタップすると、写真が共有アルバムに届きます

こんな人に
• デートや旅行で写真を撮り合うカップル
• 結婚式やコンサート、集まりで撮り合う友達
• スマホを渡したら、頭が切れた写真が返ってきたことがある人

無料で、プライベート
ペアリングとライブ撮影は無料、アカウント登録は不要です。ライブ映像は可能な限りスマホ同士で直接つながります。写真はプライベートに保存され、開けるのはあなたとパートナーだけです。広告なし、追跡なし、第三者へのデータ販売なし。データは設定からいつでも削除できます。

KENSAURUS のアプリです — 小さなアプリたち、登録の壁なし。
```

The vocabulary matches the in-app ja strings: 撮る人, ディレクター, 左/右/上/下/近く/後ろ, 完璧！撮って！, 大好き/撮り直し/完璧, 振り返り, QRをスキャン and リンクを共有. The description fixes the wrong "パン、チルト、ズーム" line.

**What's New, next iOS version (ja)** (145 / 4000):

```
新しいアイコンと、新しい名前になりました。

• 新しいアプリアイコン
• アプリ名が「help her take photo – Pose Cam」に。ホーム画面の表示名は「help her take photo」です
• ホーム画面と起動画面のロゴが新しい小文字表記に
• 安定性の向上
```

### Google Play (ja-JP)

| Field | Live today | Proposed | Count / limit |
| --- | --- | --- | --- |
| Title | `help her take photo – Pose Cam` | unchanged | 30 / 30 |
| Short description | `相手のカメラ画面を自分のスマホでライブ表示。ポーズを指示して、狙い通りの一枚を。` (40) | `カップル写真に。相手のカメラ画面を自分のスマホでライブ表示、ポーズと構図を指示して狙い通りの一枚を。` | 50 / 80 |
| Full description | 429 | the 731-char description above | 731 / 4000 |
| What's New (ja) | | `ホーム画面と起動画面のロゴが、新しいアイコンとストア名に合わせて小文字の「help her take photo」になりました。安定性も向上しています。` | 76 / 500 |

The ja short description has no "her", so it needs no inclusive alternative. Note that `release-mobile.yml` uploads only `distribution/whatsnew/whatsnew-en-US`. A ja release note has to be added by hand in Play Console, or by adding a `whatsnew-ja-JP` file to that directory.

## 8. Screenshot inventory compared with requirements

Dimensions were read from the PNG IHDR headers with node.

| Surface | Requirement | What exists | Verdict |
| --- | --- | --- | --- |
| Apple iPhone 6.9" | 1320×2868, 1290×2796 or 1260×2736 portrait. Required **unless** a 6.5" set is given. | **None** anywhere in the repo | Optional. Recommended, because Apple scales down from the largest set. |
| Apple iPhone 6.5" | 1284×2778 or 1242×2688. Satisfies the iPhone requirement when there is no 6.9" set. | origin/main tracks `distribution/store-screenshots/iphone-6.5/01-home.png` (1284×2778) only. The full set of 10 comes from `scripts/generate-marketing-screenshots.mjs` into the gitignored `distribution/screenshots/iphone-6.5/` and is not on disk. | OK, live set in ASC. **Slot #9 in ASC still shows the old "Take Photo" wordmark (BL-032).** Replace it with `01-home.png` by hand before cutting iOS, because nothing uploads screenshots. |
| Apple iPad 13" | 2064×2752 or 2048×2732. **Required**, because `supportsTablet: true`. | origin/main: `distribution/store-screenshots/ipad-13/01-home.png` (2064×2752). Local gitignored `ipad-13/` has 16 files at 2064×2752, from the old branch. | OK. **iPad 12.9 slot #2 in ASC still shows the old wordmark (BL-032).** Do **not** upload local `ipad-13/mushi-reports-dark.png`, which shows the internal feedback tool. |
| Play phone | 2–8 images, each side 320–3840 px, aspect at most 2:1 | origin/main: `android-phone/01-home.png` (1080×1920, 16:9). Local gitignored `play-assets/phone/`: 16 files at 1080×1920, light and dark, including `mushi-reports-dark`. | OK. The live Play page carries 32 screenshot images across phone and tablet sets. #1 was replaced with the new frame on 2026-09-28. |
| Play 7" tablet | optional | Local `play-assets/tablet-7/` is **1080×1920, phone-sized**, not tablet frames. | Weak. These are stretched phone shots. Regenerate from the `android-tablet-10` frame or drop them. |
| Play 10" tablet | optional | origin/main: `android-tablet-10/01-home.png` (1600×2560). Local `play-assets/tablet-10/` is 1080×1920, phone-sized. | Use the generator's 1600×2560 set, not `play-assets/tablet-10`. |
| Play feature graphic | 1024×500 | `distribution/graphics/play-feature-graphic-1024x500.png` (1024×500) on origin/main | OK. Uploaded 2026-09-28. |
| Play icon | 512×512 | `distribution/graphics/play-icon-512.png` (512×512) | OK |
| App icon source | 1024×1024 | `assets/icon.png` (1024×1024) | OK |
| Captions | n/a | The generator's headline bands are **English only**, with 10 frames: "One coach. One shutter.", "Pair in 6 seconds", … "Save your relationship". | Gap: no ja captions for the ja-JP Play listing or a future ja App Store locale. Also, "Pair in 6 seconds" is a timing claim the CHANGELOG contradicts ("about 20 seconds"). |

## 9. Owner open questions

1. **Subtitle and short description wording.**
   - **Option A:** keep the owner's `Direct her pose, nail the shot` / `See her camera live…`.
   - **Option B:** switch to the neutral alternatives `Live remote camera for couples` / `See your partner’s camera live…`. B adds 4 new indexable words and drops the repeated "her".
   - The keyword set depends on the choice. Both sets are in §6.
2. **Fix the live App Store description now, or wait?** It falsely says photos are never uploaded and that the code is open source.
   - The description is per version, so it updates with the next iOS version: BL-032, after 1.12.1.
   - If that is weeks away, consider shipping a version sooner.
   - Confirm the support email: is it `support@kensaur.us`, which is live, or `kensaurus@gmail.com`, which is in the docs?
3. **Add the ja (and th / zh-Hans) localizations in App Store Connect** before the next iOS submit, so `submit-app-store.mjs` fills them. This is a manual console step.
4. **AI photo analysis.** It gives 3 free a day, then draws on "wallet" credits.
   - Can those credits be bought anywhere, in the app or on the web? The listing declares no in-app purchases.
   - If credits can be bought outside IAP, that is a Guideline 3.1.1 question.
   - Until this is answered, the feature is left out of the copy.
5. **What's New for iOS.** Edit `CHANGELOG[0]` in `src/config/build.ts` into a combined entry covering 1.12.2, 1.12.3 and the wordmark, or the extract script ships only the 1.12.3 lines.
6. **Screenshots.**
   - Commission or generate a 6.9" iPhone set: recommended, not required.
   - Make ja-captioned sets.
   - Drop or replace the "Pair in 6 seconds" claim.
   - Replace the two stale ASC slots, iPhone 6.5 #9 and iPad #2, by hand.
7. **"Pose Cam" name clash** with PoseCam (id6780748437) and SnapPose. Accept the risk, or rename the descriptor.
8. **Credentials to push from a laptop.** Restore `secrets/asc-api-key.p8` and `secrets/google-play-service-account.json` from the Drive backup, or push only through CI. Both are absent locally today.
9. **Does the JP storefront also index en-US metadata?** Not verified. If it does, en keyword slots could be saved for terms not covered by ja. Check with ASC search analytics after launch.

## Appendix: evidence paths

All paths are in `kensaurus/help-her-take-photo` at origin/main `f03cf0a` unless they say otherwise.

- **Listing SSOT:** `distribution/listing/{en-US,ja,th,zh-Hans}/*.txt`, `docs/store-listing.md` (§ "Localized listings", Identity, banned-word tables), `scripts/listing-check.mjs`
- **Push scripts:**
  - `scripts/submit-app-store.mjs`, `scripts/push-apple-promo.mjs`, `scripts/push-play-listing.mjs`, `scripts/store-listing.js`, `scripts/extract-changelog.mjs`
  - `.github/workflows/release-mobile.yml`: Play upload step around lines 600–680, submit-app-store around line 1408
  - `eas.json` `submit.production`
- **Secrets docs:** `secrets/README.md`, a documentation file (no values copied). `gh secret list -R kensaurus/help-her-take-photo` was used for names only.
- **Identity:** `app.config.ts` (`name`, `version` 1.12.3, `ios.supportsTablet`, `ios.bundleIdentifier`, `android.package`)
- **Features:**
  - `app/{camera,viewer,pairing,scanQR,gallery,albums,albums/[id],recap,friends,settings}.tsx`
  - `src/data/poses.ts` (34 entries)
  - `src/components/{PoseCoachDeck,PairingQRCode,MemoryRecapCard}.tsx`, `src/components/gallery/PhotoViewerModal.tsx`
  - `src/services/uploadQueue.ts`
  - `src/i18n/translations.ts`, en `viewer.*` / `home.*` / `recap.*` and the ja equivalents
  - `src/config/featureFlags.ts`, `widgets/README.md`
- **Changelog:** `src/config/build.ts` `CHANGELOG` (1.9.0–1.12.3); `git log origin/main --since="60 days ago"`; commits `55a2f9b`, `c13b5b4`, `ead3ac2`, `7df16fb`, `4a47d83`
- **Backlog:** `docs/BACKLOG.md` BL-032 and BL-033
- **Screenshots:**
  - `scripts/generate-marketing-screenshots.mjs` (surfaces and captions)
  - `distribution/store-screenshots/*/01-home.png`, `distribution/graphics/*.png`
  - Local gitignored `play-assets/`, `ipad-13/`; `docs/screenshots/` (390×844, README only)
- **Live pages (2026-10-02):** `https://play.google.com/store/apps/details?id=com.kensaurus.helphertakephoto` (hl=en_US and ja), `https://apps.apple.com/us/app/id6762513666`
- **ASO sources:**
  - [Photo Poses: Pose Ideas Guide](https://apps.apple.com/us/app/-/id1551293657)
  - [PoseCam: Pose Guide Camera AI](https://apps.apple.com/app/id6780748437)
  - [SnapPose: Pose Cam Template](https://apps.apple.com/us/app/-/id6744004558)
  - [Poze: Pose Camera](https://apps.apple.com/us/app/-/id1453658722)
  - [OneSnap](https://apps.apple.com/us/app/onesnap/id6754680962)
  - [Photoshoot: Home Photographer](https://apps.apple.com/us/app/-/id6469003221)
  - [とって - パパママ/彼氏彼女の写真とって問題を解決](https://apps.apple.com/us/app/%E3%81%A8%E3%81%A3%E3%81%A6-%E3%83%91%E3%83%91%E3%83%9E%E3%83%9E-%E5%BD%BC%E6%B0%8F%E5%BD%BC%E5%A5%B3%E3%81%AE%E5%86%99%E7%9C%9F%E3%81%A8%E3%81%A3%E3%81%A6%E5%95%8F%E9%A1%8C%E3%82%92%E8%A7%A3%E6%B1%BA/id6745823838)
  - [coyattetotte 理想の構図カメラ](https://apps.apple.com/us/app/coyattetotte-%E7%90%86%E6%83%B3%E3%81%AE%E6%A7%8B%E5%9B%B3%E3%82%AB%E3%83%A1%E3%83%A9/id1523595702)
  - [Samsung JP: 2人でのおしゃれな写真の撮り方](https://www.samsung.com/jp/explore/special/smartphone-tips-54-stylish-photos-in-pairs)
  - [Keyword limit 100 characters in all languages](https://www.ibabbleon.com/copywriter-translator/2013/06/apple-finally-allows-100-characters-of-keywords-in-all-languages-of-the-app-store/)
  - [iPhone screenshot sizes 2026: required vs optional](https://appscreenshotstudio.com/blog/iphone-app-store-screenshot-sizes-2026-required-vs-optional)
- **Verification:** draft files were run through a scratch copy of origin/main `scripts/listing-check.mjs`, built with the four locales. Result: `listing-check: 4 locale(s) OK, 4 warning(s)`, the same price-word warnings in the descriptions as on main. The alt set gave the same result.
