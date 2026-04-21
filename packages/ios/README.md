# @mushi-mushi/ios

Native iOS SDK for [Mushi Mushi](https://mushimushi.dev) — the open-source,
LLM-driven bug intake, classification, and autofix platform.

> **Status**: V0.2.0 Surface stable; minor changes still possible
> before V1.0.

## Features

- 📸 **Shake-to-report** with screenshot capture
- 📦 **Offline queue** that survives app restarts (file-backed, byte-capped)
- 🎯 **Native bottom-sheet widget** with category picker and live min-length validation
- 🌐 **Device + app context** auto-attached to every report
- 🔌 **Optional Sentry bridge** (`MushiMushiSentry`) that mirrors reports into
  Sentry `UserFeedback` and links them to the most recent crash event
- 🧪 **Tested** — `swift test` runs the offline-queue + persistence suite

## Install

### Swift Package Manager (recommended)

```swift
.package(url: "https://github.com/kenroy/mushi-mushi.git", from: "ios-v0.2.0")
```

then add `MushiMushi` (and optionally `MushiMushiSentry`) to your target.

### CocoaPods

```ruby
pod 'MushiMushi', '~> 0.2'
# Optional Sentry bridge:
pod 'MushiMushi/Sentry', '~> 0.2'
```

## Quickstart

```swift
import SwiftUI
import MushiMushi

@main
struct MyApp: App {
    init() {
        Mushi.shared.configure(with: MushiConfig(
            projectId: "proj_...",
            apiKey: "mush_pk_...",
            triggerMode: .both,           // .shake | .button | .both | .none
            captureScreenshot: true,
            minDescriptionLength: 20
        ))
    }

    var body: some Scene {
        WindowGroup { ContentView() }
    }
}
```

The shake gesture is auto-installed when `triggerMode` includes `.shake`. To
present the widget programmatically:

```swift
Button("Report a bug") { Mushi.shared.showWidget() }
```

To fire a report from code (no UI):

```swift
Mushi.shared.report(
    description: "Profile photo upload spinner never stops on iPad",
    category: "bug"
)

do { try riskyOperation() }
catch { Mushi.shared.captureError(error) }
```

## Sentry bridge

```swift
import MushiMushi
import MushiMushiSentry
import Sentry

SentrySDK.start { o in o.dsn = "https://...sentry.io/0" }
Mushi.shared.configure(with: MushiConfig(projectId: "...", apiKey: "..."))
MushiSentryBridge.install()
```

Every Mushi report now produces a Sentry event with tag `source=mushi` and a
linked `UserFeedback` so it appears alongside crashes in the Sentry UI.

## Configuration

| Field                   | Default                              | Notes |
|-------------------------|--------------------------------------|-------|
| `projectId`             | _required_                           | Project UUID from Mushi admin |
| `apiKey`                | _required_                           | Public ingest key (`mush_pk_...`) |
| `endpoint`              | `https://api.mushimushi.dev`         | Override for self-hosting |
| `triggerMode`           | `.shake`                             | `shake` / `button` / `both` / `none` |
| `captureScreenshot`     | `true`                               | Disable for HIPAA-sensitive flows |
| `captureBreadcrumbs`    | `true`                               | Hooked when Sentry bridge is installed |
| `minDescriptionLength`  | `20`                                 | Matches the web SDK contract |
| `offlineQueueMaxBytes`  | `2 * 1024 * 1024`                    | Soft cap; oldest entries trim first |
| `theme`                 | `Theme(accentColor: "#22c55e")`      | Hex string |

## Privacy

- The SDK never logs secrets, tokens, or full request bodies.
- Screenshots are captured only when `captureScreenshot == true`.
- The offline queue lives in your app sandbox (`Application Support/MushiMushi/queue.ndjson`)
  and is removed when the app is uninstalled.

## License

MIT — see [LICENSE](../../LICENSE) at the repo root.
