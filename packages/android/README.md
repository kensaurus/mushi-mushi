# Mushi Mushi for Android (`dev.mushimushi:mushi-android`)

> **Your AI wrote it. Mushi Mushi tells you why it broke.**

The native Kotlin SDK for [Mushi Mushi](https://kensaur.us/mushi-mushi), for
Android apps whose users find bugs you never see. A user shakes the phone or
taps a button, describes the problem, and the report arrives in Mushi Mushi
with a screenshot and device details, where it gets a plain-English diagnosis
and a fix prompt for your AI editor.

> **Status: preview (0.4.0), not on Maven Central yet.**
> `implementation("dev.mushimushi:mushi-android:0.4.0")` will not resolve from
> any repository on its own. Build it from source as shown below until the
> first release lands.

You need a Mushi Mushi project: its project ID and an SDK API key
(`mushi_…`) from the console. The free plan works.

Docs: [Android SDK reference](https://kensaur.us/mushi-mushi/docs/sdks/android) ·
[Android quickstart](https://kensaur.us/mushi-mushi/docs/quickstart/android)

## Features

- **Shake-to-report** via `SensorManager` (no extra dependency)
- **Offline queue** that survives app restarts (file-backed, size-capped)
- **Bottom-sheet widget** (`MushiBottomSheet`) with a category picker and a
  minimum description length
- **Device and app context** attached to every report
- **Breadcrumbs**: the last 50 events, attached to every report
- **Proactive prompts**: rage taps and slow screens (`Choreographer`) can
  open the widget
- **PII scrubbing**: emails, phone numbers, card numbers, JWTs and common API
  keys are redacted before a report is sent
- **`captureError()`** sends the exception's name, message, stack and cause
- **Optional Sentry bridge** (`MushiSentryBridge`): uses reflection, so apps
  without Sentry carry no extra code

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

and depend on it from your app module's `build.gradle.kts` as usual. Gradle
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
versions, align them there. You can also run `gradle publishToMavenLocal` in
`packages/android` and add `mavenLocal()` to your repositories; the
[Android quickstart](https://kensaur.us/mushi-mushi/docs/quickstart/android)
walks through that route.

## Quickstart

```kotlin
class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Mushi.init(this, MushiConfig(
            projectId = "<project-uuid>",
            apiKey = "mushi_...",
            endpoint = "https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api",
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
`lifecycle`, `custom`. The console treats `ui.tap` as the touch version of the
web SDK's `ui.click`. The `data` map is `Map<String,
String>`; the Capacitor bridge coerces non-string JS values to strings.

## Permissions

`AndroidManifest.xml` declares only:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-feature android:name="android.hardware.sensor.accelerometer" android:required="false" />
```

The SDK never asks for runtime permissions. Screenshots come from your own
window, and shake detection uses sensors that need no user consent.

## Configuration

| Field                  | Default                              | Notes |
|------------------------|--------------------------------------|-------|
| `projectId`            | _required_                           | Project UUID from the Mushi Mushi console |
| `apiKey`               | _required_                           | Project API key (`mushi_...`) |
| `endpoint`             | _required_                           | Mushi Mushi Cloud: `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api`; self-hosters pass their own functions URL |
| `triggerMode`          | `SHAKE`                              | `SHAKE` / `BUTTON` / `BOTH` / `NONE` |
| `captureScreenshot`    | `true`                               | Disable for HIPAA-sensitive flows |
| `captureBreadcrumbs`   | `true`                               | Attaches the in-app breadcrumb buffer to each report; no Sentry needed |
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
