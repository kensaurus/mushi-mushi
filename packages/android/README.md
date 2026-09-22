# mushi-android

> **Your AI wrote it. Mushi tells you why it broke.**

Native Android (Kotlin) SDK for [Mushi Mushi](https://kensaur.us/mushi-mushi) — the
open-source, LLM-driven bug intake, classification, and autofix platform.

> **Status: preview (0.4.0).** Feature parity with the web SDK, but **not
> published to Maven Central yet** — `implementation("dev.mushimushi:mushi-android:0.4.0")`
> will not resolve from any repository on its own. Build it from source as
> shown below until the first release lands.

## Features

- 📳 **Shake-to-report** via `SensorManager` (no external `seismic` dep)
- 📦 **Offline queue** that survives app restarts (file-backed, byte-capped)
- 🎯 **Bottom-sheet widget** (`MushiBottomSheet`) with category picker and
  live min-length validation
- 🌐 **Device + app context** auto-attached to every report
- 🧭 **Breadcrumb ring buffer** — 50-entry FIFO, auto-attached to every report
- 🚨 **Proactive detection** — rage-tap and slow-screen triggers (`Choreographer`)
- 🔒 **PII scrubber** — emails, JWTs, Stripe/OpenAI/Anthropic/AWS keys redacted before submission
- ⚠️ **Exception normaliser** — `captureError()` now forwards name/message/stack/cause
- 🔌 **Optional Sentry bridge** (`MushiSentryBridge`) — uses runtime
  reflection so consumers without Sentry pay no APK cost

## Install

Until the SDK is on Maven Central, build it from source with a Gradle
composite build. Clone this repository next to your app, then include the
SDK's build in your app's `settings.gradle.kts`:

```kotlin
includeBuild("../mushi-mushi/packages/android") {
    dependencySubstitution {
        substitute(module("dev.mushimushi:mushi-android")).using(project(":"))
    }
}
```

and depend on it from your app module's `build.gradle.kts` as usual — Gradle
substitutes the local build for the coordinate:

```kotlin
dependencies {
    implementation("dev.mushimushi:mushi-android:0.4.0")
    // Optional: enable Sentry bridge.
    implementation("io.sentry:sentry-android:7.18.1")
}
```

The included build pins Android Gradle Plugin 8.5.2 and Kotlin 1.9.24 in
[`settings.gradle.kts`](./settings.gradle.kts); if your app is on different
versions, align them there.

## Quickstart

```kotlin
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Mushi.init(this, MushiConfig(
            projectId = "proj_...",
            apiKey = "mushi_...",
            triggerMode = TriggerMode.BOTH,
            captureScreenshot = true,
            minDescriptionLength = 20
        ))

        // Optional Sentry bridge:
        SentryAndroid.init(this) { it.dsn = "https://...sentry.io/0" }
        MushiSentryBridge.install()
    }
}
```

The shake gesture is auto-installed when `triggerMode` includes `SHAKE`. To
present the widget programmatically:

```kotlin
button.setOnClickListener { Mushi.showWidget() }
```

To fire a report from code (no UI):

```kotlin
Mushi.report(
    description = "Profile photo upload spinner never stops on tablets",
    category = "bug"
)

try { riskyOperation() }
catch (t: Throwable) { Mushi.captureError(t) }
```

### Breadcrumbs

Drop short notes onto the 50-entry ring buffer; every `report()` /
`captureError()` flushes them with the payload (PII-scrubbed).

```kotlin
Mushi.addBreadcrumb(MushiBreadcrumb.Category.UI_TAP, message = "Tapped Save")
Mushi.addBreadcrumb(
    MushiBreadcrumb.Category.NAVIGATION,
    level = MushiBreadcrumb.Level.INFO,
    message = "Settings → Profile",
    data = mapOf("from" to "home"),
)

val crumbs = Mushi.getBreadcrumbs()  // snapshot for debugging
```

Wire categories: `navigation`, `ui.tap`, `console`, `network`,
`lifecycle`, `custom` — admin tooling treats `ui.tap` as the touch-device
sibling of the web SDK's `ui.click`. The `data` map is `Map<String,
String>`; the Capacitor bridge coerces non-string JS values to strings.

## Permissions

`AndroidManifest.xml` declares only:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-feature android:name="android.hardware.sensor.accelerometer" android:required="false" />
```

We never request runtime permissions — screenshots are captured from your own
window, and shake detection uses sensors that don't require user consent.

## Configuration

| Field                  | Default                              | Notes |
|------------------------|--------------------------------------|-------|
| `projectId`            | _required_                           | Project UUID from Mushi admin |
| `apiKey`               | _required_                           | Project API key (`mushi_...`) |
| `endpoint`             | `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api`         | Override for self-hosting |
| `triggerMode`          | `SHAKE`                              | `SHAKE` / `BUTTON` / `BOTH` / `NONE` |
| `captureScreenshot`    | `true`                               | Disable for HIPAA-sensitive flows |
| `captureBreadcrumbs`   | `true`                               | Hooked when Sentry bridge is installed |
| `minDescriptionLength` | `20`                                 | Matches the web SDK contract |
| `offlineQueueMaxBytes` | `2 * 1024 * 1024`                    | Soft cap; oldest entries trim first |
| `theme`                | `Theme(accentColor = "#22C55E")`     | Hex string |

## Privacy

- The SDK never logs secrets, tokens, or full request bodies.
- Screenshots are captured only when `captureScreenshot == true`.
- The offline queue lives in your app sandbox (`filesDir/mushi/queue.ndjson`)
  and is removed when the app is uninstalled.

## License

[MIT](./LICENSE)
