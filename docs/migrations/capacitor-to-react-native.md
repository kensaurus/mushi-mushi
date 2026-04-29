# Capacitor → React Native: full migration plan

> **Audience:** [glot.it](https://glot.it) (and any Mushi Mushi customer running an
> Ionic / Capacitor app that wants to move to React Native for native parity, web
> reach, or both).
>
> **Last revised:** 2026-04-29 — researched against React Native **0.83**,
> Expo SDK **55**, `install-expo-modules` **stable**, Capacitor **6**,
> `@mushi-mushi/react-native` **0.8.x**, `@mushi-mushi/capacitor` **0.5.x**.

This document is the **single source of truth** for the migration. It includes
**both** of the paths that customers usually consider, marked clearly so you
can pick one and ignore the other:

| Path | Cost / month | Speed to first build | Maintenance | Recommended for |
|------|--------------|----------------------|-------------|-----------------|
| **Path A** — Expo SDK 55 + EAS Build | $19–$99 (Production tier) plus build minutes once you exceed the free quota | Hours | Lowest | Teams that want to outsource native CI |
| **Path B** — React Native CLI + GitHub Actions + Fastlane | $0 (open-source CI) on GitHub-hosted `macos-14`, plus GitHub Actions minutes; or $0 on a self-hosted Mac mini after hardware payback | 2–3 days | Higher (you own the runners + signing) | Cost-sensitive teams, teams already on GitHub Actions, the explicit ask from glot.it |

> glot.it has chosen **Path B** (no Expo, no EAS, GitHub Actions to save money).
> The full Path B is the bulk of this document. Path A is included as a one-page
> escape hatch in case priorities change.

---

## Table of contents

1. [Decision matrix: should you migrate at all?](#1-decision-matrix-should-you-migrate-at-all)
2. [The web question: React Native Web vs keep Next.js](#2-the-web-question-react-native-web-vs-keep-nextjs)
3. [Pre-migration audit checklist](#3-pre-migration-audit-checklist)
4. [Path A: Expo SDK 55 + EAS Build (1 page)](#4-path-a-expo-sdk-55--eas-build-the-easy-path)
5. [Path B: React Native CLI + GitHub Actions + Fastlane (the chosen path)](#5-path-b-react-native-cli--github-actions--fastlane-the-chosen-path)
   - [5.1 Project bootstrap with the New Architecture](#51-project-bootstrap-with-the-new-architecture)
   - [5.2 Selectively pulling in Expo SDK packages without Expo CLI](#52-selectively-pulling-in-expo-sdk-packages-without-expo-cli)
   - [5.3 Code signing with Fastlane match](#53-code-signing-with-fastlane-match)
   - [5.4 GitHub Actions: Android (AAB → Play Internal)](#54-github-actions-android-aab--play-internal)
   - [5.5 GitHub Actions: iOS (Archive → TestFlight)](#55-github-actions-ios-archive--testflight)
   - [5.6 Self-hosted Mac mini: when does it pay off?](#56-self-hosted-mac-mini-when-does-it-pay-off)
   - [5.7 Required GitHub secrets, in one place](#57-required-github-secrets-in-one-place)
6. [Capacitor → React Native plugin map](#6-capacitor--react-native-plugin-map)
7. [Mushi Mushi during the migration](#7-mushi-mushi-during-the-migration)
   - [7.1 Capacitor SDK → React Native SDK API mapping](#71-capacitor-sdk--react-native-sdk-api-mapping)
   - [7.2 Zero backend changes: same project, same key, same console](#72-zero-backend-changes-same-project-same-key-same-console)
   - [7.3 Get the install snippet from the admin console](#73-get-the-install-snippet-from-the-admin-console)
   - [7.4 CLI one-liner](#74-cli-one-liner)
   - [7.5 Verifying the SDK in the new app](#75-verifying-the-sdk-in-the-new-app)
   - [7.6 Mushi-side improvements shipping with this guide](#76-mushi-side-improvements-shipping-with-this-guide)
8. [Recommended timeline (6 weeks, 1 engineer)](#8-recommended-timeline-6-weeks-1-engineer)
9. [Risks and how we mitigate each](#9-risks-and-how-we-mitigate-each)
10. [Final go/no-go checklist](#10-final-gono-go-checklist)
11. [References](#11-references)

---

## 1. Decision matrix: should you migrate at all?

Migrate **if** at least two of these are true:

- ☐ You are hitting WebView performance ceilings (jank in chat scroll, slow
  large-list rendering, audio/video latency).
- ☐ You need a native API that has no maintained Capacitor plugin (e.g. a fresh
  iOS 18 / Android 15 framework).
- ☐ Your team is already strong in React; the JSX → React Native step is small.
- ☐ You want to publish a "real native app" review listing rather than a
  hybrid one (Apple's review bar for hybrid apps has been getting stricter).

Do **not** migrate if:

- ☒ Your only complaint is "the WebView feels slow" but you have not actually
  profiled it. A well-tuned WebView often beats a poorly-tuned RN screen.
- ☒ You ship daily and cannot afford a 4–6 week feature freeze on the mobile
  surface.
- ☒ Your differentiator is **web-first SEO** (RN Web is OK for app-shell
  content but still loses to Next.js for SEO landing pages — see §2).

For glot.it the answer is **yes, migrate** — chat scroll perf and access to
native iOS speech recognition are both blockers, and the team is React-fluent.

---

## 2. The web question: React Native Web vs keep Next.js

You have three structural options for the **web** experience after migrating
the native app to React Native:

| Option | Description | Best for | Caveat |
|--------|-------------|----------|--------|
| **2a. Keep Next.js, port only mobile** | Native app uses RN; web stays on its current Next.js / React stack | SEO-sensitive landing pages, complex web-only features | You maintain two component libraries |
| **2b. RN Web for the app shell + Next.js for marketing** | RN Web powers the post-login app (chat, lessons), Next.js owns the marketing site | Want one code path for "the app" but keep an SEO web | Some component duplication at the boundary |
| **2c. Full RN Web (single codebase)** | Everything is RN, web is RN Web served by Next.js or Expo Router | Maximum code reuse, simple team setup | RN Web's accessibility / SEO story is improving but still behind native HTML in 2026 |

> **Recommendation for glot.it:** Option **2a**. Your marketing site and
> open-graph cards depend on first-class HTML; ports of those to RN Web cost
> more than they save. Keep the web stack you already have and port only the
> Capacitor app to RN. This also simplifies the admin console — you keep
> shipping `@mushi-mushi/web` to the marketing site and `@mushi-mushi/react-native`
> to the new app, against the same project.

> **If you reconsider later:** RN Web in 2026 is genuinely usable — Discord,
> Twitter Lite, Wix, and Microsoft Office all ship RN Web in production. The
> cost-of-switch is mostly in routing and SEO, not in components.

---

## 3. Pre-migration audit checklist

Run this **before** writing a single line of RN. One uncatalogued plugin can
add a week.

```bash
cd glot-it
# 1. Inventory every Capacitor plugin
grep -E "@capacitor|@ionic-native" package.json

# 2. Inventory every Ionic component you actually use
grep -rE "<ion-[a-z-]+" src/ | sort -u | wc -l

# 3. Inventory every web-only API you call directly
grep -rE "navigator\.|window\.|document\." src/ | wc -l

# 4. Map each finding to an RN equivalent using §6 of this doc
```

Block the migration on any plugin where the RN equivalent is not yet
identified. Don't start porting screens until the plugin map is signed off.

**Other gates:**

- ☐ All Capacitor plugins have an RN counterpart in §6 (or you accept writing
  a `TurboModule`).
- ☐ Native designers have looked at the existing screens and confirmed they
  can be re-themed with `react-native-reanimated` / Tamagui / your chosen UI
  kit.
- ☐ Your CI budget covers ~30 mobile builds / month (rough heuristic for one
  engineer in active migration).
- ☐ You have an Apple Developer Program account ($99/yr), a Google Play
  Console account ($25 one-time), and admin access to both.
- ☐ Your team has read [React Native 0.82 release notes][rn-082] and accepts
  that the New Architecture (Fabric / Bridgeless) is the only supported mode.

---

## 4. Path A: Expo SDK 55 + EAS Build (the easy path)

Included for completeness; **glot.it is using Path B**. If your priorities
ever shift back to "less to maintain, willing to pay", this is the one-page
recipe.

### 4.1 Bootstrap

```bash
npx create-expo-app@latest glot-it-rn --template blank-typescript
cd glot-it-rn

# Mushi Mushi
npx mushi-mushi init                # auto-detects Expo, installs @mushi-mushi/react-native
```

### 4.2 Build & ship

```bash
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --platform all   # cloud build, ~15 min
npx eas-cli@latest submit --latest        # uploads to Play + TestFlight
```

EAS handles signing, caching, and store upload. You configure App Store Connect
and Play credentials **once** via `eas credentials` and never touch a `.p12`
again.

**Cost:** EAS pricing as of 2026 is $19/mo (Starter, ~30 medium builds) or
$99/mo (Production, ~250 builds). [Pricing][eas-pricing].

**When this beats Path B:** the team is < 3 engineers, you don't already own
GitHub Actions infra, and ~$1k/year of CI cost is invisible inside payroll.

For **glot.it**, EAS was rejected due to cost. The rest of this document is
Path B.

---

## 5. Path B: React Native CLI + GitHub Actions + Fastlane (the chosen path)

This section assumes:

- React Native **0.83** (current as of 2026-04). New Architecture is **on by
  default**; the legacy bridge was removed in 0.82.
- Hermes is the JS engine (also default).
- You will use `install-expo-modules` to **selectively** consume Expo SDK
  packages (`expo-haptics`, `expo-secure-store`, `expo-image-picker`,
  `expo-sensors`) without buying into the Expo CLI / Metro plugin / EAS Build
  triad. This is officially supported and stable. [Expo bare workflow docs][expo-bare].
- CI is **GitHub-hosted runners** by default (`ubuntu-latest` for Android,
  `macos-14` for iOS). §5.6 covers when to switch to self-hosted.

### 5.1 Project bootstrap with the New Architecture

```bash
npx @react-native-community/cli@latest init GlotIt --version 0.83.0
cd GlotIt

# Confirm New Architecture is on (default since 0.82, verify anyway)
grep newArchEnabled android/gradle.properties     # newArchEnabled=true
grep RCT_NEW_ARCH_ENABLED ios/Podfile             # ENV['RCT_NEW_ARCH_ENABLED'] = '1'

# Hermes is the default JS engine; confirm
grep hermes_enabled ios/Podfile                    # :hermes_enabled => true
```

Recommended day-1 dependencies (all New-Arch compatible as of 2026-04):

```bash
pnpm add react-native-reanimated@^4 \
        react-native-gesture-handler@^2 \
        react-native-safe-area-context@^5 \
        react-native-screens@^4 \
        @react-navigation/native @react-navigation/bottom-tabs @react-navigation/native-stack \
        @react-native-async-storage/async-storage \
        @shopify/flash-list@^2

# iOS
cd ios && bundle exec pod install && cd ..
```

If your design system is Tailwind-shaped, add `nativewind@^5` (RN 0.83 +
Tailwind 4 compatible).

### 5.2 Selectively pulling in Expo SDK packages without Expo CLI

The Expo team officially supports installing individual Expo modules into a
**pure React Native CLI** project. You get `expo-haptics`, `expo-secure-store`,
`expo-image-picker`, `expo-sensors`, `expo-camera`, etc. — without ever
touching the Expo CLI or EAS Build.

```bash
# One-time: wire up expo-modules-core (auto-edits AppDelegate, settings.gradle)
npx install-expo-modules@latest

# Then add the Expo packages you want
pnpm add expo-haptics expo-secure-store expo-image-picker expo-sensors

cd ios && bundle exec pod install && cd ..
```

That single `install-expo-modules` step:

- Patches `AppDelegate.swift` (or `.mm`) to bootstrap `ExpoModulesCore`.
- Patches `android/settings.gradle` and `android/app/build.gradle` to register
  Expo modules via Gradle.
- Sets the iOS deployment target to 15.1 (Expo SDK 55 minimum) and Android
  `minSdk = 24`.

After this step, every future `pnpm add expo-*` call **just works** —
`pnpm install` + `pod install` handles registration automatically. This is
the modern equivalent of the deprecated "ejected Expo" workflow and it is
the recommendation in the **bare workflow** docs. [Source][expo-bare].

> **Why use Expo packages at all if we don't want Expo?**
> Because the alternative — `react-native-haptic-feedback` +
> `react-native-keychain` + `react-native-image-picker` + `react-native-shake`
> — is four separately-maintained libraries with four upgrade cadences and
> four different New-Arch readiness levels. The Expo equivalents are
> co-maintained, ship together with each Expo SDK release, and are the only
> ones tested against `newArchEnabled=true` on every PR by the Expo team.

### 5.3 Code signing with Fastlane match

The single biggest source of CI fragility on iOS is signing. `fastlane match`
solves it once: it stores certificates and provisioning profiles in a
**private Git repo**, encrypted, and every CI run pulls them down with one
command.

#### 5.3.1 One-time setup (on a Mac, locally)

```bash
# Inside GlotIt/
gem install bundler
bundle init
echo "gem 'fastlane'" >> Gemfile
bundle install

# Initialize fastlane in ios/
cd ios && bundle exec fastlane init   # answer "Manual setup"

# Initialize match against a private GitHub repo
bundle exec fastlane match init        # choose "git", paste git@github.com:glotit/ios-certs.git
```

You will be asked for a `MATCH_PASSWORD`. **Save this** — you'll add it to
GitHub Secrets in §5.7.

Then create the certs + profiles for each target:

```bash
bundle exec fastlane match appstore --readonly false
bundle exec fastlane match development --readonly false
```

This populates the private cert repo. From this point onward, every CI run
uses `--readonly true` and only **reads** from the repo.

#### 5.3.2 `ios/fastlane/Fastfile`

```ruby
default_platform(:ios)

platform :ios do
  desc "Build & upload to TestFlight"
  lane :beta do
    setup_ci                                  # creates a temporary keychain on CI
    app_store_connect_api_key(
      key_id:      ENV["ASC_KEY_ID"],
      issuer_id:   ENV["ASC_ISSUER_ID"],
      key_content: ENV["ASC_KEY_CONTENT"],    # the .p8 contents, base64-decoded
      duration:    1200,
      in_house:    false
    )
    match(type: "appstore", readonly: true)
    increment_build_number(xcodeproj: "GlotIt.xcodeproj")
    build_app(
      workspace:    "GlotIt.xcworkspace",
      scheme:       "GlotIt",
      configuration:"Release",
      export_method:"app-store",
      clean:        true
    )
    upload_to_testflight(skip_waiting_for_build_processing: true)
  end
end
```

Key lines:

- `setup_ci` is the canonical Fastlane way to provision a temporary keychain
  on a CI runner. It avoids the "Mac asks for keychain password" hang. [Source][fastlane-gh].
- `app_store_connect_api_key` uses an **App Store Connect API key (.p8)**
  rather than a user account — required for CI because Apple ID 2FA cannot be
  satisfied from a runner. [Source][asc-key].
- `match(type: "appstore", readonly: true)` is the only allowed mode in CI.
  Never let CI write to the cert repo.

#### 5.3.3 `android/fastlane/Fastfile`

```ruby
default_platform(:android)

platform :android do
  desc "Build & upload signed AAB to Play Internal track"
  lane :internal do
    gradle(task: "clean")
    gradle(
      task:        "bundle",
      build_type:  "Release",
      properties: {
        "android.injected.signing.store.file"     => ENV["ANDROID_KEYSTORE_PATH"],
        "android.injected.signing.store.password" => ENV["ANDROID_KEYSTORE_PASSWORD"],
        "android.injected.signing.key.alias"      => ENV["ANDROID_KEY_ALIAS"],
        "android.injected.signing.key.password"   => ENV["ANDROID_KEY_PASSWORD"],
      }
    )
    upload_to_play_store(
      track:                  "internal",
      json_key_data:          ENV["GOOGLE_PLAY_JSON_KEY"],
      skip_upload_metadata:   true,
      skip_upload_changelogs: true,
      skip_upload_images:     true,
      skip_upload_screenshots:true
    )
  end
end
```

### 5.4 GitHub Actions: Android (AAB → Play Internal)

`.github/workflows/android-release.yml`:

```yaml
name: Android release
on:
  workflow_dispatch:
  push:
    tags: ['v*']

jobs:
  build:
    runs-on: ubuntu-latest               # ~$0.008/min for public, $0.008/min for private
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - run: pnpm install --frozen-lockfile

      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'

      - uses: ruby/setup-ruby@v1
        with:
          ruby-version: '3.3'
          bundler-cache: true
          working-directory: android

      - name: Decode keystore
        run: |
          mkdir -p android/app/keystore
          echo "${{ secrets.ANDROID_KEYSTORE_BASE64 }}" | base64 -d > android/app/keystore/release.keystore

      - name: Decode Play service account JSON
        run: echo "${{ secrets.GOOGLE_PLAY_JSON_KEY_BASE64 }}" | base64 -d > /tmp/play.json

      - name: Fastlane internal lane
        working-directory: android
        env:
          ANDROID_KEYSTORE_PATH:    ${{ github.workspace }}/android/app/keystore/release.keystore
          ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
          ANDROID_KEY_ALIAS:        ${{ secrets.ANDROID_KEY_ALIAS }}
          ANDROID_KEY_PASSWORD:     ${{ secrets.ANDROID_KEY_PASSWORD }}
          GOOGLE_PLAY_JSON_KEY:     ${{ secrets.GOOGLE_PLAY_JSON_KEY }}
        run: bundle exec fastlane internal
```

**Throughput:** Android builds are CPU-bound, not Mac-bound, so
`ubuntu-latest` is fine. Expect ~10 min per build on a cold runner.

### 5.5 GitHub Actions: iOS (Archive → TestFlight)

`.github/workflows/ios-release.yml`:

```yaml
name: iOS release
on:
  workflow_dispatch:
  push:
    tags: ['v*']

jobs:
  build:
    runs-on: macos-14                     # Apple Silicon runner
    timeout-minutes: 90
    steps:
      - uses: actions/checkout@v4
        with:
          ssh-key: ${{ secrets.MATCH_REPO_SSH_KEY }}    # to clone the cert repo

      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - run: pnpm install --frozen-lockfile

      - uses: ruby/setup-ruby@v1
        with:
          ruby-version: '3.3'
          bundler-cache: true
          working-directory: ios

      - name: Cache CocoaPods
        uses: actions/cache@v4
        with:
          path: ios/Pods
          key: pods-${{ hashFiles('ios/Podfile.lock') }}

      - name: pod install
        working-directory: ios
        run: bundle exec pod install

      - name: Fastlane beta lane
        working-directory: ios
        env:
          MATCH_PASSWORD:        ${{ secrets.MATCH_PASSWORD }}
          MATCH_GIT_URL:         ${{ secrets.MATCH_GIT_URL }}
          ASC_KEY_ID:            ${{ secrets.ASC_KEY_ID }}
          ASC_ISSUER_ID:         ${{ secrets.ASC_ISSUER_ID }}
          ASC_KEY_CONTENT:       ${{ secrets.ASC_KEY_CONTENT }}
          FASTLANE_USER:         ${{ secrets.APPLE_ID }}
          FASTLANE_PASSWORD:     ${{ secrets.APPLE_PASSWORD }}
        run: bundle exec fastlane beta
```

**Throughput:** Apple Silicon `macos-14` runners cut iOS build times roughly
in half versus Intel `macos-13`. Expect ~25 min per cold build with the cache,
~12 min with a warm cache. [Source][gh-runners].

### 5.6 Self-hosted Mac mini: when does it pay off?

GitHub-hosted `macos-14` minutes are billed at **$0.16/min** for private
repos (10× the Linux price). Quick payback table at 2026 rates:

| Builds / month | Mac minutes / month | Hosted cost / month | Mac mini M2 amortized over 24 months | Break-even |
|----------------|---------------------|---------------------|-------------------------------------|------------|
| 30 | 360 | **$57.60** | $25 hardware + $0 power | Yes — host yourself |
| 100 | 1200 | **$192.00** | $25 + ~$5 power | Strongly yes |
| 300 | 3600 | **$576.00** | $25 + $10 | Definitely yes |

**Recommendation for glot.it:** Start on `macos-14` (zero ops). When you cross
~50 iOS builds/mo, buy a base-model Mac mini M2 ($599), install
`actions/runner`, and label it `self-hosted-mac`. Switch your workflow with
one line:

```yaml
runs-on: [self-hosted, macOS, ARM64, glot-it]
```

The runner registers as a macOS service (`launchd`) so it survives reboots.
[Setup guide][self-hosted].

### 5.7 Required GitHub secrets, in one place

Add these in **Settings → Secrets and variables → Actions**:

```
# iOS — Fastlane match
MATCH_PASSWORD                 the password you set during `match init`
MATCH_GIT_URL                  git@github.com:glotit/ios-certs.git
MATCH_REPO_SSH_KEY             a deploy key with read access to the certs repo

# iOS — App Store Connect API key (preferred over Apple ID)
ASC_KEY_ID                     10-char key ID from App Store Connect
ASC_ISSUER_ID                  UUID issuer ID
ASC_KEY_CONTENT                contents of the .p8, base64-decoded as a single string

# iOS — fallback Apple ID (only if you can't use the API key)
APPLE_ID                       you@yourdomain.com
APPLE_PASSWORD                 app-specific password from appleid.apple.com

# Android — signing
ANDROID_KEYSTORE_BASE64        `base64 release.keystore`
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD

# Android — Play Console
GOOGLE_PLAY_JSON_KEY           contents of the service account JSON, as a string
GOOGLE_PLAY_JSON_KEY_BASE64    `base64 service-account.json` (the workflow decodes it)
```

> **Treat the certs repo and these secrets as production credentials.**
> Anyone with read access to all of them can ship a build to your users.
> Use GitHub environments (`production`) to require manual approval before
> the iOS workflow runs on `main`.

---

## 6. Capacitor → React Native plugin map

Each row is a Capacitor plugin (or a bare web API used in a Capacitor app)
and its modern RN equivalent. Pick the **leftmost** option in column 3 unless
you have a reason not to.

| Capacitor plugin / web API | What it does | RN equivalent (preferred → alternatives) |
|----------------------------|--------------|------------------------------------------|
| `@capacitor/preferences` | Key-value store | `expo-secure-store` (encrypted) → `@react-native-async-storage/async-storage` |
| `@capacitor/storage` (legacy) | Same | Same as above |
| `@capacitor/filesystem` | Read/write files | `expo-file-system` → `react-native-fs` |
| `@capacitor/camera` | Camera + photo picker | `expo-image-picker` (camera + library) → `expo-camera` (live preview) |
| `@capacitor/haptics` | Vibration patterns | `expo-haptics` |
| `@capacitor/network` | Connectivity status | `@react-native-community/netinfo` |
| `@capacitor/share` | OS share sheet | `react-native` built-in `Share` API |
| `@capacitor/clipboard` | Copy / paste | `@react-native-clipboard/clipboard` |
| `@capacitor/geolocation` | Lat / lng | `expo-location` → `react-native-geolocation-service` |
| `@capacitor/push-notifications` | APNs / FCM | `@notifee/react-native` + `@react-native-firebase/messaging` |
| `@capacitor/local-notifications` | Schedule local | `@notifee/react-native` |
| `@capacitor/app` | Lifecycle / URL handling | `react-native` built-in `AppState`, `Linking` |
| `@capacitor/browser` | In-app browser | `expo-web-browser` |
| `@capacitor/keyboard` | Keyboard events | `react-native` built-in `Keyboard` |
| `@capacitor/status-bar` | Status bar style | `expo-status-bar` |
| `@capacitor/splash-screen` | Splash control | `expo-splash-screen` |
| `@capacitor/device` | Device info | `expo-device` → `react-native-device-info` |
| `@capacitor/screen-orientation` | Lock orientation | `expo-screen-orientation` |
| `@ionic/storage` | Sqlite-backed KV | `expo-sqlite` → `op-sqlite` (perf) |
| `@capacitor-community/sqlite` | Direct SQLite | `expo-sqlite` → `op-sqlite` |
| `@capacitor-community/in-app-purchases` | IAP | `react-native-iap` |
| `@capacitor/text-zoom` | Accessibility text scaling | RN built-in `PixelRatio.getFontScale()` |
| `window.matchMedia` | Dark mode detection | RN built-in `useColorScheme()` |
| `cordova-plugin-*` | Anything Cordova | Almost always replaced by Expo or RN community equivalent — search first |
| **`@mushi-mushi/capacitor`** | **Bug capture** | **`@mushi-mushi/react-native`** — see §7 |

If you find a plugin that has no RN counterpart, the order of escalation is:

1. Search npm for `react-native-<plugin>` — there usually is one.
2. Check the Expo SDK package list ([docs.expo.dev/versions/latest][expo-pkgs]).
3. Check React Native Directory ([reactnative.directory][rn-directory]).
4. Wrap the existing iOS/Android SDK as a `TurboModule` yourself (a few hours
   of work for a small surface).

---

## 7. Mushi Mushi during the migration

The single most important property of the migration: **you do not change
anything on the Mushi side.** Same project, same API key, same admin console,
same dashboard. Reports from the Capacitor build and the React Native build
land in the same inbox under the same project ID.

### 7.1 Capacitor SDK → React Native SDK API mapping

`@mushi-mushi/capacitor` (current) vs `@mushi-mushi/react-native` (target):

| Capacitor (`Mushi.*`) | React Native | Notes |
|-----------------------|--------------|-------|
| `Mushi.configure({ projectId, apiKey })` | `<MushiProvider projectId apiKey>` at app root | Provider replaces the imperative configure call |
| `Mushi.report({ description, severity, metadata })` | `useMushiReport()(...)` hook | Returns `{ submitting, submit }` for inline forms |
| `Mushi.captureScreenshot()` | _Not yet wired in 0.8 — capture happens server-side from session_ | See §7.6 for the in-flight enhancement |
| `Mushi.showWidget()` | `useMushiWidget().open()` | Same effect, now driven by hook |
| `Mushi.setUser({ id, email })` | `useMushi().setUser({ id, email })` | Same |
| `Mushi.setMetadata({ ... })` | `useMushi().setMetadata({ ... })` | Same |
| `Mushi.flushQueue()` | _Auto-flushed on `MushiProvider` mount_ | The RN provider attempts a flush automatically; manual flush also exposed via `useMushi().flush()` |
| `Mushi.addListener('reportSubmitted', ...)` | `useMushi().on('reportSubmitted', ...)` | Same event names |
| Config: `triggerMode: 'shake' \| 'button' \| 'both'` | `config.widget.trigger: 'shake' \| 'button' \| 'both'` | Renamed for parity with web SDK |
| Config: `captureScreenshot: boolean` | `config.capture.screenshot: 'on-report' \| 'auto' \| 'off'` | Three-way to match web; `true` → `'on-report'`, `false` → `'off'` |
| Config: `triggerInsetPreset: 'tabBarSafe' \| 'dockSafe'` | `config.widget.inset: { bottom, right }` (CSS-var-style values supported) | Inset is now token-driven so it composes with your design system |
| Native: `useNativeWidget: true` (renders a Swift/Kotlin widget) | _RN ships a JS-only widget._ Use `<MushiBottomSheet>` directly if you want a custom mount point | Tradeoff: lower fidelity, but no native bridge to maintain |

**Code-level diff** for the typical glot.it surface area:

```ts
// BEFORE — packages/glot-it/src/main.ts (Capacitor)
import { Mushi } from '@mushi-mushi/capacitor'

await Mushi.configure({
  projectId: 'glot-it-prod',
  apiKey: process.env.PUBLIC_MUSHI_KEY,
  triggerMode: 'shake',
  captureScreenshot: true,
  triggerInsetPreset: 'tabBarSafe',
})
```

```tsx
// AFTER — apps/glot-it-rn/App.tsx (React Native)
import { MushiProvider } from '@mushi-mushi/react-native'

export default function App() {
  return (
    <MushiProvider
      projectId="glot-it-prod"
      apiKey={process.env.EXPO_PUBLIC_MUSHI_KEY!}
      config={{
        widget: { trigger: 'shake', inset: { bottom: 96, right: 16 } },
        capture: { screenshot: 'on-report' },
      }}
    >
      <RootNavigator />
    </MushiProvider>
  )
}
```

**Reporting from inside a screen:**

```tsx
import { useMushiReport, useMushiWidget } from '@mushi-mushi/react-native'

function ChatScreen() {
  const { open } = useMushiWidget()
  const { submit, submitting } = useMushiReport()

  // Manual submit (e.g. after a "Report this response" tap on a chat bubble)
  async function reportBadResponse(messageId: string) {
    await submit({
      description: 'AI returned an off-topic answer',
      metadata: { messageId, screen: 'chat' },
      severity: 'medium',
    })
  }

  return <Button title="Open bug report" onPress={open} />
}
```

### 7.2 Zero backend changes: same project, same key, same console

- Reports from the new RN build appear in the same `glot-it` project on the
  Mushi admin console as your existing Capacitor reports.
- The same API key works for both. **Do not rotate** until the Capacitor
  build is sunset, or both clients lose the ability to submit.
- Custom metadata (`metadata.screen`, `metadata.messageId`, etc.) keeps
  flowing — Mushi treats it as opaque JSON.
- Replay / reproduction steps: reports from RN are tagged with `sdk:
  react-native@0.8` so you can filter them on the dashboard during the rollout.

### 7.3 Get the install snippet from the admin console

In the Mushi Mushi admin console, on **Onboarding**, **Projects → glot-it**,
or **Settings → Health**, the **Install SDK** card now includes
**React Native**, **Expo**, and **Capacitor** tabs alongside React / Vue /
Svelte / Vanilla. Pick **React Native** to get a copy-paste-correct snippet
populated with your real `projectId` and (right after a key mint) `apiKey`.

The card is the same one used by every other framework — same configurator
controls (trigger mode, capture toggles), same live preview. The mobile
trigger settings additionally persist to the project's runtime SDK config so
new builds pick them up without a redeploy.

### 7.4 CLI one-liner

If you'd rather skip the console:

```bash
cd glot-it-rn
npx mushi-mushi init                  # auto-detects react-native, installs the right package, writes the snippet
```

The CLI auto-detects React Native (and Expo, and Capacitor) and writes the
correct `MushiProvider` boilerplate into `App.tsx`, plus the env var
declarations into your `.env.local`. After this guide ships:

- The CLI's React Native and Expo snippets use the **real**
  `MushiProvider projectId apiKey` props (not the imaginary
  `enableShakeToReport` from older docs).
- The CLI's Capacitor snippet uses **`Mushi.configure({...})`** (not the
  bug `Mushi.init({...})` it was emitting before — fixed in this same PR).

### 7.5 Verifying the SDK in the new app

Once the provider is mounted, run a smoke pass:

```ts
// In any screen, after your normal app boots
import { useMushi } from '@mushi-mushi/react-native'

function DebugScreen() {
  const mushi = useMushi()
  return (
    <Button
      title="Send test report"
      onPress={() =>
        mushi.submitReport({
          description: 'Smoke test from RN build',
          severity: 'low',
          metadata: { build: 'rn-migration-poc' },
        })
      }
    />
  )
}
```

Expected behavior:

1. Tap the button.
2. Within ~2s the report appears under **Project → glot-it → Reports**, tagged
   `sdk:react-native@0.8`.
3. Console capture (last 100 logs) and network capture (last 50 fetches) are
   attached.
4. If the runner is offline, the report is queued in `AsyncStorage` under
   `@mushi:offline_queue` and flushes on next provider mount.

If anything fails, check:

- ☐ `MushiProvider` is at the **root** of your component tree, above any
  `NavigationContainer`.
- ☐ `apiKey` is the **public** key (starts with `mushi_`), not the
  Supabase service role key.
- ☐ Your release build has internet permission (Android: default; iOS: ATS
  blocks `http://` so use HTTPS for the Mushi endpoint, which is the default).

### 7.6 Mushi-side improvements shipping with this guide

To make this exact migration trivially easy, this PR ships:

| Change | Where | Why |
|--------|-------|-----|
| **React Native, Expo, Capacitor tabs** added to the admin Install SDK card | `apps/admin/src/lib/sdkSnippets.ts`, `apps/admin/src/components/SdkInstallCard.tsx` | Customers can copy the right snippet from the console without leaving the app |
| **Capacitor CLI snippet bug fix** (`Mushi.init` → `Mushi.configure`) | `packages/cli/src/detect.ts` | Capacitor users were copy-pasting code that crashed at runtime |
| **React Native docs corrected** to drop `react-native-shake` / `enableShakeToReport` and document `expo-sensors` + `widget.trigger` | `apps/docs/content/sdks/react-native.mdx`, `apps/docs/content/quickstart/react-native.mdx` | Public docs were lying about peer deps |
| **Capacitor docs corrected** to use `Mushi.configure` and the real config shape | `apps/docs/content/sdks/capacitor.mdx` | Same — public docs were calling the wrong API |
| **This migration guide** is also published at `/migrations/capacitor-to-react-native` on the docs site | `apps/docs/content/migrations/capacitor-to-react-native.mdx` | One canonical URL we can hand to any customer doing this port |

Tracked but **not** in this PR (call them out separately if needed):

- Wiring `useNavigationCapture` automatically inside `MushiProvider` so the
  navigation timeline ships with every report.
- Native screenshot capture via `react-native-view-shot` or
  `expo-screen-capture` (currently only the web SDK captures images).
- A `Mushi.diagnose()` health check in the RN package mirroring the web one.

---

## 8. Recommended timeline (6 weeks, 1 engineer)

This is the timeline we'd quote a customer if they asked for one. Pad each
week by 25 % if you have multiple engineers context-switching.

| Week | Track | Outcome |
|------|-------|---------|
| **1** | Audit + bootstrap | Plugin map signed off (§3, §6). RN 0.83 skeleton with New Architecture, design tokens ported, navigation skeleton in place. |
| **2** | Design system + auth | Login, OAuth, secure-store, deep links working. Mushi provider mounted (§7). |
| **3** | Primary screens | Home, Lesson, Chat ported. Mushi smoke-test flowing on internal builds. |
| **4** | Secondary screens + plugins | Profile, Settings, Notifications, IAP. Capacitor plugin parity from §6 verified. |
| **5** | CI/CD + signing | Fastlane match set up (§5.3). Android AAB to Play Internal (§5.4) and iOS to TestFlight (§5.5) both green from `main`. |
| **6** | Beta + monitoring | Closed beta on TestFlight + Play Internal, with proactive Mushi triggers turned **off** in production builds. Daily review of Mushi reports drives the polish list. |

After week 6, dual-ship: keep the Capacitor build live for ~2 weeks while
the RN build proves itself in the wild, then sunset Capacitor.

---

## 9. Risks and how we mitigate each

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| A Capacitor plugin has no RN equivalent | Medium | High | Audit in week 1 (§3). Budget 1 week per missing plugin to wrap a TurboModule. |
| iOS code signing breaks CI | High | Medium | `fastlane match` + `setup_ci` (§5.3). Run the iOS workflow on a feature branch **before** rolling it to `main`. |
| GH Actions macOS minutes blow past budget | Medium | Medium | Watch the bill weekly. When you cross ~50 builds/mo, switch to a self-hosted Mac mini (§5.6). |
| New Architecture incompatibility with a community library | Low (now) | Medium | Pin every lib to a New-Arch-tested version (most major libs have shipped this since 2024). Test on `newArchEnabled=true` from day 1 in week 1. |
| Mushi reports stop flowing during cutover | Low | High | The RN build uses the **same** `projectId` and `apiKey` as the Capacitor build. Don't rotate keys until the Capacitor build is sunset. Verify both are landing during dual-ship. |
| Team picks up bad practices from stale docs | Medium | Low | Public docs were fixed in this PR. The migration guide is now the canonical reference. |
| Migration drifts into "rewrite the world" | High | High | Lock scope: port screens 1:1, do NOT redesign. UX changes are a separate project after the cutover. |

---

## 10. Final go/no-go checklist

Before you tell stakeholders the migration is "done":

- [ ] Every Capacitor plugin from §6 has an RN replacement that **runs** (not
  just installs) on a real device.
- [ ] iOS release workflow has shipped a TestFlight build from a clean repo
  clone (verifies you're not depending on local Mac state).
- [ ] Android release workflow has shipped an AAB to Play Internal from a
  clean repo clone.
- [ ] `MushiProvider` is mounted at the app root and a smoke-test report
  appears in the Mushi admin console within 5 s.
- [ ] The Capacitor build still works (you have not yet rotated the API key).
- [ ] Closed beta has been live for ≥ 7 days and Mushi shows < 3 P0 reports.
- [ ] Crashlytics / Sentry (if you use them) shows < 0.5 % crash rate on the
  RN build.
- [ ] Marketing site (web) is unchanged and still ships `@mushi-mushi/web`.
- [ ] You have a written rollback plan: re-publish the latest Capacitor IPA
  to TestFlight, ship a hotfix to App Store Connect within 24 h.

When all of these are checked: rotate the API key, sunset the Capacitor
build, archive the Capacitor repo, and ship.

---

## 11. References

- **Mushi Mushi**
  - [`@mushi-mushi/react-native` README](../../packages/react-native/README.md)
  - [`@mushi-mushi/capacitor` README](../../packages/capacitor/README.md)
  - [`@mushi-mushi/web` README](../../packages/web/README.md)
  - [Mushi Mushi CLI README](../../packages/cli/README.md)
- **React Native**
  - [Upgrade Helper (latest)](https://react-native-community.github.io/upgrade-helper/)
  - [About the New Architecture][rn-082] — why bridgeless is the default
  - [React Native 0.83 release notes](https://reactnative.dev/blog/2026/03/12/react-native-0.83)
- **Expo (used selectively)**
  - [Install Expo modules in an existing React Native project][expo-bare]
  - [Expo SDK package list][expo-pkgs]
- **CI/CD**
  - [Fastlane GitHub Actions guide][fastlane-gh]
  - [App Store Connect API key setup][asc-key]
  - [GitHub-hosted runner sizes & pricing][gh-runners]
  - [Self-hosted runner setup on macOS][self-hosted]
  - [EAS Build pricing][eas-pricing] (for comparison)
- **React Native Web**
  - [reactnative.directory](https://reactnative.directory/) — RN library directory used in §6 escalation order
  - [React Native Web docs](https://necolas.github.io/react-native-web/)

[rn-082]: https://reactnative.dev/architecture/landing-page
[expo-bare]: https://docs.expo.dev/bare/installing-expo-modules/
[expo-pkgs]: https://docs.expo.dev/versions/latest/
[fastlane-gh]: https://docs.fastlane.tools/best-practices/continuous-integration/github/
[asc-key]: https://docs.fastlane.tools/app-store-connect-api/
[gh-runners]: https://docs.github.com/en/actions/using-github-hosted-runners/about-github-hosted-runners
[self-hosted]: https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/about-self-hosted-runners
[eas-pricing]: https://expo.dev/pricing
[rn-directory]: https://reactnative.directory/
