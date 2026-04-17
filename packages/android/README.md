# mushi-android

Native Android (Kotlin) SDK for [Mushi Mushi](https://mushimushi.dev) — the
open-source, LLM-driven bug intake, classification, and autofix platform.

> **Status**: V0.2.0 (Wave C C2). Surface stable; minor changes still possible
> before V1.0.

## Features

- 📳 **Shake-to-report** via `SensorManager` (no external `seismic` dep)
- 📦 **Offline queue** that survives app restarts (file-backed, byte-capped)
- 🎯 **Bottom-sheet widget** (`MushiBottomSheet`) with category picker and
  live min-length validation
- 🌐 **Device + app context** auto-attached to every report
- 🔌 **Optional Sentry bridge** (`MushiSentryBridge`) — uses runtime
  reflection so consumers without Sentry pay no APK cost

## Install

Add to your app's `build.gradle.kts`:

```kotlin
dependencies {
    implementation("dev.mushimushi:mushi-android:0.2.0")
    // Optional: enable Sentry bridge.
    implementation("io.sentry:sentry-android:7.18.1")
}
```

Snapshots are published to OSSRH; releases sync to Maven Central within a few
hours of `gradle publish`.

## Quickstart

```kotlin
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Mushi.init(this, MushiConfig(
            projectId = "proj_...",
            apiKey = "mush_pk_...",
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
| `apiKey`               | _required_                           | Public ingest key (`mush_pk_...`) |
| `endpoint`             | `https://api.mushimushi.dev`         | Override for self-hosting |
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
