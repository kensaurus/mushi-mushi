# glot.it: store listing draft (App Store + Google Play)

**Status:** draft only. Nothing was pushed to App Store Connect or Play Console, and no store console was opened.
**Drafted:** 2026-10-02
**Evidence:** the glot.it repo at `origin/main` = `bbb1cf9ba` (2026-10-01). The local main checkout is on `fix/sentry-b6-b7-grant-drift`, which is behind `origin/main` (see Finding 1). All repo reads were `git show origin/main:<path>` / `git grep origin/main`. The working tree was not touched.

| | |
|---|---|
| App | glot.it, a Thai-learning app (Next.js static export in Capacitor) |
| Android package | `com.glotit.app` |
| iOS bundle id | `com.glotit.app` (`ios/App/App.xcodeproj/project.pbxproj`) |
| App Store app id | `6761582648` |
| Live versions | **1.102.0** on both stores (App Store public page; Play public page) |
| **Play title (live, exact)** | `glot.it – Learn Thai`, with an en dash U+2013. 20 chars. ja-JP: `glot.it – タイ語を学ぶ` (16) |
| App Store name (live) | `glot.it` |
| App Store subtitle (live) | `Learn Thai via music & culture` |
| Pending on origin/main | iOS name = Play title, and subtitle `Bite-size lessons + AI tutor`. Both ship with the next iOS release (`scripts/submit-app-store.mjs`). |
| Home-screen label | `glot.it` (`CFBundleDisplayName`, Android `app_name`, `capacitor.config.ts appName`). It stays as is. |

---

## 1. Current listing findings

### What is live (public store pages, fetched 2026-10-02)

- **Google Play en-US:** title `glot.it – Learn Thai`.
  - Short description: `Speak Thai and get your tones right, with bite-size lessons and an AI tutor.`
  - The full description matches `origin/main:distribution/listing/en-US/full-description.txt` ("Thai has five tones… See your tones… smart review… 12 everyday scenarios…").
  - Version 1.102.0, 500+ downloads.
  - What's new (en): "Fixed issues that could make the app feel stuck…"
- **Google Play ja-JP:** title `glot.it – タイ語を学ぶ`.
  - Short description: `正しい声調でタイ語を話そう。短いレッスンとAIチューターで練習できます。`
  - The full description matches `origin/main:distribution/listing/ja/full-description.txt`.
  - **The ja "What's new" is the 1.101 friend-tree text, not the 1.102 notes.** `origin/main:distribution/whatsnew/whatsnew-ja` is stale, while `whatsnew-en-US` is 1.102.
- **App Store (US):** name `glot.it`, subtitle `Learn Thai via music & culture`.
  - The description still opens with the old founding promo ("Pitch-contour tone mirror… All 162 lessons open for founding members").
  - Version 1.102.0. Devices: iPhone, iPad, Mac (M1+), Vision.
  - Price: Supporter IAP at $6.99/mo and $49.99/yr.
  - **Languages: English only.**

### What the repo holds (`origin/main`)

- The source of truth is `distribution/listing/<locale>/{play-title,subtitle,promo-text,keywords,short-description,full-description}.txt` across 16 locales, plus `distribution/whatsnew/whatsnew-<locale>`.
- `play-title.txt` is the store name on BOTH stores (`scripts/growth/_listings-data.mjs:405-427`). This already implements "Play naming is the source of truth".
- Current origin/main en-US copy:

  | Field | Text | Length |
  |---|---|---|
  | Subtitle | `Bite-size lessons + AI tutor` | 28 |
  | Promo | "Say a Thai word and see where your tone slipped…" | 163 |
  | Keywords | `alphabet,pronunciation,tones,bangkok,songkran,vocab,flashcards,script,fsrs,srs,travel,podcast,lyrics` | |
  | Short | "Speak Thai and get your tones right, with bite-size lessons and an AI tutor." | 76 |

- **Validators exist.** `npm run appstore:check` (`push-apple.mjs`) enforces the following, and the drafts below pass it (Appendix B):
  - Apple length limits.
  - A price-word ban: `free`, `無料`, `ฟรี`…
  - App Review Guideline 1.1 risk phrases: `role play`, `paste any`, `adult`, `ロールプレイ`…
  - The voice guide's banned "slop" phrases (`docs/growth/voice-guide.md`).

### Claims in the live copy that the code does not back

| Live claim | Code says | Fix in the draft |
|---|---|---|
| "All **162** lessons" | `TOTAL_LESSON_COUNT` = **161** (`packages/core/src/curriculum/stages.ts:70`, pinned by `__tests__/lesson-count-ssot.test.ts`). `app/practice/layout.tsx` already says 161. `locales/en/misc.json:1146` also says 162. | Says **161** |
| Pitch line "next to a **native speaker's**", "listen to **native audio**" | The reference track is TTS. `speaking-practice.tsx` → `useTts().resolveAudioUrl` → `AudioCompare nativeAudioUrl`. Clips are ElevenLabs/fal.ai voices cached in S3 (commit `c2474542d`, #132). | Says "a reference Thai voice" / "お手本のタイ語音声". Plain "listen". |
| "**Works offline**" (for everyone) | `features/offline/components/download-button.tsx:47,173` returns early unless `isPro`, with a cap of 5 lessons (`lib/offline/types.ts:21`). Everyone gets it only while `glot_app_config.open_access` is on (`hooks/@_hooks-README.md:911`). | "The optional Supporter plan adds offline lesson downloads and more AI chats" stays true either way. |
| "Report concerns from **Settings → Help & Feedback**" | No such label exists. The real labels are `settings.appAndHelp` = "App & Help" / "アプリとヘルプ" and `settings.feedback` = "Feedback" / "フィードバック". | Settings → App & Help → Feedback; ja: 設定 → アプリとヘルプ → フィードバック |
| Tutor "corrects your wording **and pronunciation**" | Text chat returns `corrected_thai` (`features/chat/components/chat-bubble.tsx:65-80`), which corrects wording. Pronunciation and tone notes come only from Voice mode's post-call feedback (`features/voice-tutor/@_voice-tutor-README.md`: `voice-feedback-card.tsx`). Voice mode depends on ElevenLabs Conversational AI; see Open question 4. | Says "It corrects your Thai as you go" |
| "12 **everyday** scenarios" | There are 12 (`stores/chat.ts:580+`): cafe, market, directions, hotel, friends, restaurant, taxi, free, temple, festival, street-food, be-yourself. Two of them are open-ended rather than everyday. | Says "12 conversation scenarios, such as…" |

---

## 2. Metadata push mechanism and credentials (presence only)

There is no fastlane (no Fastfile, Appfile, Deliverfile or Supplyfile) and no `eas.json`. The repo uses its own Node scripts against the official APIs.

| Path | Pushes | Mechanism | Credential (presence) |
|---|---|---|---|
| `scripts/growth/push-apple.mjs` (`npm run appstore:check` = dry-run, `npm run appstore:push` = apply, plus `--promo-only` and `--create-version x.y.z`) | name (from `play-title.txt`), subtitle, promo, keywords, description, what's new, for 16 locales | App Store Connect API, ES256 JWT (`_asc-jwt.mjs`). It only patches a version in `PREPARE_FOR_SUBMISSION` or a rejected state. | `.env.local` defines `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_PATH`, `ASC_APP_ID` (names verified, values not read). Key file present: `secrets/AuthKey_<KEY_ID>.p8`. |
| `scripts/growth/push-play.mjs` (dry-run by default, `--validate`, `--apply`) | Play title, short description, full description per locale | Android Publisher API v3 edits flow (`_play-jwt.mjs`). The service account needs Release manager. | `.env.local` defines `GOOGLE_PLAY_PACKAGE_NAME`, `GOOGLE_PLAY_SERVICE_ACCOUNT_PATH`. File present: `secrets/google-play-service-account.json`. |
| CI `.github/workflows/build-mobile-capacitor.yml` → `scripts/submit-app-store.mjs` | On each iOS release: what's new, promo, description and keywords on the new version, plus name and subtitle on the appInfo | ASC API | GitHub secrets present: `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY_P8`. The app id is inline (`APP_STORE_CONNECT_APP_ID: "6761582648"`). |
| CI same workflow, `r0adkll/upload-google-play@v1` | Play release notes from `whatsNewDirectory: distribution/whatsnew/` (Play caps release notes at 500 chars) | Play Developer API | GitHub secret present: `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` |
| `scripts/growth/gen-release-notes.mjs` (`npm run appstore:notes` / `appstore:release`) | Writes `distribution/whatsnew/*` from the latest CHANGELOG block | Anthropic API (Haiku) | `ANTHROPIC_API_KEY` defined in `.env.local` |
| Play screenshots | `phoneScreenshots` | Uploaded ad hoc with the Android Publisher API in #131 (`7fd15fad7`). **No script in the repo does this.** | Same Play service account |

Nothing is missing for a metadata push. **Run every push from an up-to-date `origin/main` checkout, never from the current main checkout** (Finding 1).

---

## 3. Feature inventory (evidence at `origin/main` `bbb1cf9ba`)

| Feature used in copy | Evidence |
|---|---|
| Pitch-line tone feedback against a reference voice | `features/speech/components/audio-compare.tsx:63` `extractPitchContour`, `:183` `PitchContourSvg`, `:495` `AudioCompare({ nativeAudioUrl })`. The reference comes from TTS: `features/practice/components/speaking-practice.tsx:23,131,620`. |
| Smart review (FSRS) | `package.json` `ts-fsrs ^5.4.1`, `packages/core/src/fsrs.ts`, `lib/fsrs.ts`, route `app/review/` |
| 161 lessons, 12 stages, greetings to literary Thai | `packages/core/src/curriculum/stages.ts:47-71` |
| Five lesson steps (learn, reading, listening, speaking, drill) | `features/practice/components/lesson-shell.tsx:13` |
| Word bank | `features/word-bank/`, route `app/words/` |
| AI tutor with 12 scenarios and corrections | `stores/chat.ts:580+` (`CHAT_SCENARIOS`), `features/chat/components/scenario-picker.tsx`, `chat-bubble.tsx:65-80` (`corrected_thai`) |
| "Try it out loud" in the tutor chat | `features/chat/components/chat-input.tsx:13,58,303` (mic button with `useSttWithFallback`) |
| Custom scenarios (why the copy says "built-in") | `features/chat/components/scenario-picker.tsx:20` mounts `CustomScenarioInput` |
| Report path | Settings → App & Help → Feedback: `app/settings/_components/settings-support-section.tsx:70,147` |
| Voice mode with post-call feedback (not in the copy; see Q4) | `features/voice-tutor/`, route `app/chat/voice/` |
| Thai script: tracing and handwriting | `features/alphabet/components/script-tracing-canvas.tsx:24`, `handwriting-progress.tsx:59` (`glot_handwriting_progress`), edge function `glot-handwriting`, route `app/alphabet/` |
| Song lyrics line by line with romanization | `features/lyrics/` (`LyricsViewMode "thai" \| "romanized" \| "english" \| "full"`), route `app/lyrics/` |
| Podcasts at your level | `features/podcast/hooks/use-podcast.ts:101` (`difficulty`), route `app/podcast/` |
| Camera to save words from signs and packaging | `features/word-bank/components/photo-vocab-sheet.tsx:41,241` (`capturePhoto`), mounted in `app/words/_components/words-content-overlays.tsx:73`, edge function `glot-photo-vocab` |
| Grammar and culture notes | routes `app/grammar/`, `app/culture/`; `features/grammar/`, `features/culture/` |
| Offline downloads (Supporter, max 5) | `features/offline/components/download-button.tsx:26-51,173`, `lib/offline/types.ts:21` |
| All lessons open; Supporter is optional | `app/faq/page.tsx:17` ("All ${TOTAL_LESSON_COUNT} lessons are open from day one, with no paywall"), `app/pricing/layout.tsx:6` |
| Monthly AI allowance (not in the copy) | `supabase/functions/_shared/ai-spend.ts:2` ($0.50/UTC-month), CHANGELOG 1.100.0 |
| Report path | `locales/en/settings.json:147,152`, `locales/ja/settings.json:118,232` |
| UI languages | `locales/`: ar de en es fr hi id it ja km ko lo ms my pt ru tl vi zh. **ja yes, th no.** |
| iPad | `TARGETED_DEVICE_FAMILY = "1,2"` (`project.pbxproj:320,344`), `UISupportedInterfaceOrientations~ipad` in `Info.plist` |

**Last 60 days on `origin/main`:** 261 non-merge commits. The user-facing ones:
- 1.100.0 (08-22): monthly AI allowance, cache-first TTS with STT fallback, device keys and wallet.
- 1.101.0 (09-14): plant-a-tree referral, attribution, adaptive placement ladder, a study path that picks your weakest skill, a "make it yours" sheet, shareable tone-score card, supporter nudges.
- 1.102.0 (09-27): Android layout pass.

**Unreleased since 1.102.0:**
- `c2474542d` TTS fix (#132): stored clips served from S3; one failing phrase no longer silences all audio. This is a server-side edge function, so it is likely already live for 1.102.0 users.
- `bbb1cf9ba` Next RCE patch (web/server; not in the native binary).
- Store-copy commits #127, #128, #131.
- CHANGELOG has **no `[Unreleased]` block.**

---

## 4. ASO keyword research

Method: WebSearch of the top results for "learn Thai app" and "タイ語 学習 アプリ". **I had no search-volume tool, so competition is rated qualitatively** by how many of the top results target the term. There are no volume numbers here.

What the searches showed:
- **en:** Ling ("200+ lessons", speech recognition for tones), StudyThai.ai, "Thai Language Tones" (also a live pitch contour), Lentil, Talkpal, Thai Drill.
- **ja:** ごったい (dictionary), "Thai Reading | Alphabet & Tone" (pitch-contour graphs), タイ文字アルファベット (tracing), Ling.
- Pitch-contour feedback is **not unique**, so the copy does not claim "only app".
- `docs/growth/gtm-plan-2026-q4.md:129` notes Duolingo has no Thai course. Trademark rules keep "duolingo" out of the keywords.

### en-US

| Keyword | Placement | Why |
|---|---|---|
| learn thai | Name (`glot.it – Learn Thai`) | The head term and the clearest intent. It is in the Play title already and now goes in the iOS name. Competition is very high: every competitor's title has it. |
| thai tones / tones | Subtitle | glot.it's sharpest claim (the pitch line). Medium competition (Thai Language Tones, Ling). High relevance. |
| thai alphabet / alphabet | Subtitle | A high-intent beginner search. Medium-high competition (many alphabet-only apps). Backed by the tracing and handwriting features. |
| ai tutor | Subtitle | Rising query family, and it differentiates glot.it from phrasebooks. Medium competition (Talkpal, StudyThai.ai). |
| pronunciation | Keywords | Pairs with "thai" from the name. Intent matches the tone feature. Medium competition. |
| speak | Keywords | Matches "speak thai". The most common phrasing among travelers. |
| phrases, travel, bangkok | Keywords | Traveler intent ("thai phrases for travel"), matching the scenarios (taxi, market, restaurant). Phrasebook apps compete here, at low to medium. |
| vocabulary, script, reading, writing, grammar | Keywords | Long-tail study terms, each backed by a route (`/words`, `/alphabet`, `/grammar`). Low competition. |
| podcast, lyrics | Keywords | Unusual among Thai apps, so competition is low. Small volume, but anyone searching it is a good fit. |

I dropped some of the current keywords:
- `alphabet` and `tones` now sit in the subtitle, and Apple does not reward repeats.
- `fsrs` and `srs` are jargon with near-zero consumer search, and voice.md bans FSRS in user copy.
- `songkran` is seasonal and not backed by a feature.
- `vocab` is replaced by `vocabulary`.
- `flashcards` was cut for length; it is the first to restore if you trim elsewhere.

### ja

| キーワード | Placement | Why |
|---|---|---|
| タイ語 / 学ぶ | Name (`glot.it – タイ語を学ぶ`) | The head term, already in the Play ja title. Apple combines name and keywords, so タイ語+勉強 covers "タイ語 勉強". |
| 発音, 声調 | Subtitle | Japanese learners struggle most with 声調. Few apps target it (Thai Reading). This is glot.it's strength. |
| タイ文字 | Subtitle | A high-intent search. Medium-high competition (タイ文字アルファベット and others). Backed by tracing and handwriting. |
| AI会話 | Subtitle | The scenario tutor. Few JP Thai apps lead with it. |
| 勉強, 独学, 初心者, 入門 | Keywords | The way people in Japan phrase study searches. Low to medium competition. |
| 単語, 単語帳, フレーズ, 文法, 読み書き, リスニング, スピーキング | Keywords | Skill terms, each backed by a feature. |
| タイ旅行, 海外旅行, バンコク | Keywords | Thailand is a top destination for Japanese travelers, and the traveler scenarios match. |
| 駐在 | Keywords | Bangkok has a large community of Japanese expats on assignment, which is a high-value segment. |
| ポッドキャスト, 歌詞, ローマ字, 語学 | Keywords | Differentiators and generic category terms. |

I dropped some of the current ja keywords:
- タイ語学習, タイ語レッスン and タイ語会話 repeat タイ語 from the name.
- 声調 and 発音 moved to the subtitle.
- タイ音楽 is replaced by 歌詞.

---

## 5. en-US listing (proposed)

Counts come from `scripts/growth/_listings-data.mjs` (origin/main) `.length` and `[...s].length`; they are identical for this text (Appendix B). The `–` in the name counts as 1.

### App Store

| Field | Text | Count / limit |
|---|---|---|
| Name | `glot.it – Learn Thai` | 20 / 30 |
| Subtitle | `Tones, Alphabet & AI Tutor` | 26 / 30 |
| Promotional text | `Say a Thai word and see where your tone slipped, drawn as a pitch line. Short lessons, smart review so words stick, and an AI tutor to practice with.` | 149 / 170 |
| Keywords | `pronunciation,speak,phrases,vocabulary,script,reading,writing,bangkok,travel,podcast,lyrics,grammar` | 99 / 100 |
| Description | below | 1685 / 4000 |
| What's New (provisional; see Q2) | below | 191 / 4000 (and under Play's 500) |

The subtitle replaces the pending origin/main subtitle `Bite-size lessons + AI tutor`, which carries no searchable terms beyond "AI tutor".

### Google Play

| Field | Text | Count / limit |
|---|---|---|
| Title | `glot.it – Learn Thai` (unchanged, live) | 20 / 30 |
| Short description | `See where your Thai tone slipped, read the script and practice with an AI tutor.` | 80 / 80 |
| Full description | same text as the App Store description (the repo shares one file) | 1685 / 4000 |

### Description (both stores)

```
Thai has five tones. Get one wrong and "horse" (ม้า) becomes "dog" (หมา). glot.it shows you where your tone slipped and helps you say it right.

• See your tones: say a word, and a pitch line shows your voice next to a reference Thai voice, so you can see where the tone went wrong.
• Remember what you learn: smart review brings each word back right before you would forget it.
• Practice with an AI tutor: 12 conversation scenarios, such as ordering at a café, bargaining at a market, asking for directions or taking a taxi. It corrects your Thai as you go.
• Read and write Thai script: consonants, vowels and tone marks, with tracing and handwriting practice.
• Learn from real Thai: song lyrics line by line with romanization, podcasts at your level, and your camera to save words from signs and packaging.
• Grammar and culture notes when you want to know why a phrase works the way it does.

How it works
1. Pick a lesson. Each one runs five short steps: learn the words, read them in context, listen, speak with feedback, then a mixed drill.
2. Every word you study goes into your word bank and comes back for review when it's due.
3. When you're ready, try it out loud with the AI tutor.

All 161 lessons are open from day one, from first greetings to literary Thai. The optional Supporter plan adds offline lesson downloads and more AI chats.

The built-in tutor scenarios are written for learners. To report a concern, open Settings → App & Help → Feedback. Designed for general audiences.

Download glot.it and start with สวัสดี.

---
Terms of Use (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
Privacy Policy: https://kensaur.us/glot-it/privacy/
```

### What's New (next version, provisional)

```
What's new

• Lesson and word audio is more reliable. Saved audio clips load first, and if one phrase can't be voiced, only that phrase uses your device's voice instead of all sound stopping.
```

---

## 6. ja listing (proposed)

| Field | Text | Count / limit |
|---|---|---|
| App Store name | `glot.it – タイ語を学ぶ` | 16 / 30 |
| App Store subtitle | `発音と声調、タイ文字、AI会話` | 15 / 30 |
| Promotional text | `タイ語を声に出すと、声調のずれがピッチの線で見えます。短いレッスン、忘れる前に出てくるスマート復習、練習相手のAIチューター。` | 63 / 170 |
| Keywords | `勉強,単語,単語帳,フレーズ,タイ旅行,バンコク,初心者,入門,リスニング,スピーキング,読み書き,文法,ポッドキャスト,歌詞,語学,ローマ字,駐在,海外旅行,独学` | 82 / 100 |
| Play title | `glot.it – タイ語を学ぶ` (unchanged, live) | 16 / 30 |
| Play short description | `声調のずれが見える発音練習、タイ文字、AIチューターとの会話でタイ語を話せるように。` | 42 / 80 |
| Description (both stores) | below | 879 / 4000 |
| What's New (provisional) | below | 99 / 4000 (and under Play's 500) |

The ja subtitle replaces the pending `短いレッスン＋AIチューター`.

```
タイ語には5つの声調があります。1つ間違えるだけで「馬」（ม้า）が「犬」（หมา）に。glot.itは、声調がどこでずれたかを見せて、正しく話せるようにします。

• 声調が見える：単語を発音すると、お手本のタイ語音声と並べたピッチ曲線で、どこで声調がずれたかがわかります。
• 覚えたことを忘れない：スマート復習が、忘れる直前に単語をもう一度出してくれます。
• AIチューターと会話練習：カフェで注文する、市場で値段を交渉する、道をたずねる、タクシーに乗るなど12のシナリオ。あなたのタイ語をその場で直してくれます。
• タイ文字の読み書き：子音・母音・声調記号を、なぞり書きと手書き練習で学べます。
• 本物のタイ語で学ぶ：歌詞を1行ずつローマ字つきで、レベルに合ったポッドキャストで。看板やパッケージの単語はカメラで保存できます。
• 文法と文化のノートで、その言い方になる理由もわかります。

使い方
1. レッスンを選ぶ。各レッスンは短い5ステップ：単語を覚える、文脈で読む、聞く、フィードバックつきで話す、最後にミックステスト。
2. 学んだ単語はすべて単語帳に入り、復習のタイミングで戻ってきます。
3. 準備ができたら、AIチューターと声に出して試しましょう。

161レッスンは初日からすべて開放。あいさつから文学的なタイ語まで。任意のSupporterプランで、レッスンのオフライン保存とAIチャットの追加が使えます。

標準のチューターシナリオは学習者向けに作られています。気になる点は 設定 → アプリとヘルプ → フィードバック から報告できます。一般向けに設計されています。

glot.itをダウンロードして、สวัสดีから始めよう。

---
Terms of Use (EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
Privacy Policy: https://kensaur.us/glot-it/privacy/
```

```
新機能:

• レッスンと単語の音声がより安定しました。保存済みの音声を先に読み込み、1つのフレーズが再生できない場合も、そのフレーズだけ端末の音声に切り替わり、すべての音が止まることはありません。
```

---

## 7. Thai (th): no new draft

I did not write a th listing, for two reasons:
- **The app has no Thai UI locale.** `locales/` has 19 languages, and Thai is not one of them. Thai is the language being taught, not the interface language. A Thai speaker who installs the app sees an English (or other) UI.
- **Thai speakers are not the audience.** Learners of Thai mostly have English, Japanese, Chinese or Korean devices, expats in Thailand included. They see their own locale's listing, or en-US as the default.

A th listing does already exist on origin/main (`distribution/listing/th/*`, Play title `glot.it – เรียนภาษาไทย`). `docs/growth/aso-listings.md` frames it as copy for Thai hosts and teachers recommending the app to foreign friends. I left it alone. If it is kept, apply the same fixes there: 162 → 161, "native speaker", and the report path. See Q5.

---

## 8. Screenshot inventory vs requirements (`origin/main`, dimensions read from PNG headers)

| Requirement | Needed? | Have | Gap |
|---|---|---|---|
| Apple iPhone 6.9" (1320×2868 or 1290×2796), portrait | **Required** | Raw `distribution/screenshots/ios-6.9/` has 10 at 1320×2868. Composed `distribution/store-screenshots/ios-6.9/en-US/` has 9 at 1320×2868 (no `01_home`). | **Old UI** (last changed 2026-04-13). Captions exist for **en-US only**. No ja set. `docs/APP_STORE_SUBMISSION.md` says the next iOS version should re-capture the five new Play screens at Apple sizes (e.g. 440×956 @3x). |
| Apple iPhone 6.7" / 6.5" (optional; scales from 6.9") | optional | `ios-6.7` has 10 at 1290×2796, `ios-6.5` has 10 at 1284×2778. Composed en-US sets have 9 each. | Same old UI |
| Apple iPad 13" (2064×2752 or 2048×2732) | **Required**: `TARGETED_DEVICE_FAMILY = "1,2"` | Raw `ipad-13/` has 10 at 2048×2732. Composed `ipad-13/en-US/` has 9 at 2048×2732. | Old UI, en-US only, no new-UI iPad capture. Alternatively, drop iPad support (Q6). |
| Play phone screenshots (2–8, 320–3840 px, ≤2:1) | **Required** | `distribution/store-screenshots/play-phone/en-US/` has 5 at 1080×1920 (16:9): tone feedback, lesson, AI tutor, smart review, Thai script. This set is live (#131). `store-assets/screenshots/` has 8 at 1080×1920 (an older set). | **No ja phone set**, so ja-JP shows the en-US images. Captionless. |
| Play feature graphic (1024×500) | **Required** | `store-assets/feature-graphic.png` at 1024×500 | Not checked for being current |
| Play icon (512×512) | **Required** | `store-assets/icon-512.png` at 512×512 | None |
| App Store icon (1024×1024) | **Required** (from the asset catalog) | `distribution/app-icon-1024.png` at 1024×1024 | None |
| Other | — | `distribution/screenshots/` has 9 at 514×927 (the old web mockups that #131 replaced). `screenshots/ios` has 6 at 766×1067. `ios-promo` has 6 at 1290×2796. `app-review-screenshots/` holds IAP paywall shots. | Not store-sized; ignore |

---

## 9. Open questions for the owner

1. **Stale checkout risk (needs action).** The main glot.it checkout is on `fix/sentry-b6-b7-grant-drift`, which predates #127 and #128. Its `_listings-data.mjs` hardcodes Play `title: "glot.it"` and its en-US short description is "Free Thai: … 162 lessons during founding."
   - Running `node scripts/growth/push-play.mjs --apply` from that checkout would **shorten the live Play title to bare "glot.it"** in every locale and restore the old copy.
   - Always push from a fresh `origin/main`.
2. **What's New source.** The only user-facing change since 1.102.0 is the server-side TTS fix (#132), which may already be live.
   - Should the next note describe it, or wait until real app changes land? CHANGELOG has no `[Unreleased]` block.
   - Separately, `whatsnew-ja` (and other non-en files) still hold 1.101 text. Regenerate all locales with `npm run appstore:notes` before the next release.
3. **App Store shows "English" only.** `ios/App/App/Info.plist` has no `CFBundleLocalizations`, although the web UI ships 19 locales including ja.
   - Add the localizations so the App Store lists 日本語 and the others. This is a native change, so it needs a store build.
4. **Voice mode.** The AI tutor's spoken mode (`/chat/voice`) uses ElevenLabs Conversational AI. #132 says the ElevenLabs account is on the Free plan and that direct API calls have failed since about 2026-08-02.
   - Does voice mode still work? Until that is confirmed, the copy only says the tutor "corrects your Thai", which the text chat does. It does not promise spoken pronunciation scoring.
5. **Keep or drop the th listing?** (Section 7.) If kept, apply the same factual fixes.
6. **iPad.** Keep iPad support, which means producing a new-UI 13" set, or set `TARGETED_DEVICE_FAMILY = 1`? The App Store page also lists Mac and Vision.
7. **Offline claim after founding.** When `open_access` turns off, offline downloads become Supporter-only (max 5). The draft is written to stay true in both states. Confirm that is the intended positioning.
8. **"161" everywhere.** `locales/en/misc.json:1146` (`trialLandingKeepsBody`) and the other locales still say 162. Sweep them in the same batch as this copy.
9. **Subtitle change.** This draft replaces the pending `Bite-size lessons + AI tutor` with a keyword-bearing subtitle.
   - Confirm before it rides the next iOS release.
   - Note that `submit-app-store.mjs` pushes name and subtitle automatically.
10. **Compliance line and custom scenarios.** Learners can write their own tutor scenarios (`CustomScenarioInput`). So the live line "All tutor scenarios are curated for learners" overstates the case. The draft says "The built-in tutor scenarios are written for learners" (ja: 標準のチューターシナリオは…).
    - Confirm this wording is acceptable for the Guideline 1.1 posture.
    - Confirm custom-scenario input is moderated server-side.

---

## Appendix A: how to apply (owner, not done here)

1. Copy the fields above into `distribution/listing/{en-US,ja}/*.txt` and `distribution/whatsnew/whatsnew-{en-US,ja}` on a branch cut from `origin/main`.
2. Run `npm run appstore:check` and `node scripts/growth/push-play.mjs` (dry-run).
3. Play: `node scripts/growth/push-play.mjs --validate --apply`, then `--apply`.
4. iOS: name, subtitle, keywords and description ride the next release through `submit-app-store.mjs`. Promo text can go live right away with `npm run appstore:push -- --promo-only`.
5. Batch it with other work, per the CI cost rules (one PR, one deploy).

## Appendix B: validator output (repo gate on the drafts)

These are the origin/main validator functions run against the drafts. The same validators run in `npm run appstore:check` and `push-play.mjs`. The scratch mirror holds `_listings-data.mjs` and `_env.mjs` from origin/main, with the draft files placed in `distribution/listing/{en-US,ja}`.

```
== en-US  apple=en-US play=en-US
  apple violations: []
  play violations:  []
== ja  apple=ja play=ja-JP
  apple violations: []
  play violations:  []

## counts en-US  (.length = UTF-16 units used by the validator | [...s].length = code points)
  play-title           20 |   20  / 30
  subtitle             26 |   26  / 30
  promo-text          149 |  149  / 170
  keywords             99 |   99  / 100
  short-description    80 |   80  / 80
  full-description   1685 | 1685  / 4000
  whatsnew            191 |  191  / 500
  keyword terms repeated from name/subtitle: []
  keywords spaces around commas: false

## counts ja
  play-title           16 |   16  / 30
  subtitle             15 |   15  / 30
  promo-text           63 |   63  / 170
  keywords             82 |   82  / 100
  short-description    42 |   42  / 80
  full-description    879 |  879  / 4000
  whatsnew             99 |   99  / 500
  keyword terms repeated from name/subtitle: []
  keywords spaces around commas: false
```

The validators checked:
- The price-word ban (`free`, `無料`…).
- The Guideline 1.1 phrases (`role play`, `paste any`, `adult`, `ロールプレイ`…).
- The en voice-guide slop patterns.
- Spaces around commas in keywords.
- All Apple and Play length limits.

The first pass failed (en keywords at 110, Play short description at 81) and was trimmed to the values shown.

## Appendix C: sources

- Public store pages (fetched 2026-10-02): https://play.google.com/store/apps/details?id=com.glotit.app (hl=en_US and hl=ja) · https://apps.apple.com/us/app/id6761582648
- Competitor scan: https://apps.apple.com/app/studythai-ai/id6759391196 · https://talkpal.ai/?p=1285352 · https://appshunter.io/ios/app/thai-drill/id1514751982/similar · https://apps.apple.com/jp/app/id1629178814 (ごったい) · https://spark.mwm.ai/jp/apps/thai-reading-alphabet-tone/1445544247 · https://ling-app.com/jpn/th/おすすめタイ語勉強アプリ/
