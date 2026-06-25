# @mushi-mushi/ios

> **Your AI wrote it. Mushi tells you why it broke.**

iOS native bridge for Capacitor and React Native hosts.


Native iOS SDK for [Mushi Mushi](https://kensaur.us/mushi-mushi) — the open-source,
LLM-driven bug intake, classification, and autofix platform.

> **Status**: V0.4.0 Feature parity with the web SDK.

## Features

- 📸 **Shake-to-report** with screenshot capture
- 📦 **Offline queue** that survives app restarts (file-backed, byte-capped)
- 🎯 **Native bottom-sheet widget** with category picker and live min-length validation
- 🌐 **Device + app context** auto-attached to every report
- 🧭 **Breadcrumb ring buffer** — 50-entry FIFO, auto-attached to every report
- 🚨 **Proactive detection** — rage-tap and slow-screen triggers auto-open the widget
- 🔒 **PII scrubber** — emails, JWTs, Stripe/OpenAI/Anthropic/AWS keys redacted before submission
- ⚠️ **Exception normaliser** — `captureError()` now forwards name/message/stack/cause
- 🧪 **Tested** — `swift test` runs the offline-queue, breadcrumb, PII, and exception suite

## Install

### Swift Package Manager (recommended)

```swift
.package(url: "https://github.com/kensaurus/mushi-mushi.git", from: "0.4.0")
```

then add `MushiMushi` to your target.

### CocoaPods

```ruby
pod 'MushiMushi', '~> 0.4'
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

### Breadcrumbs

Drop short notes onto the 50-entry ring buffer; every `report()` /
`captureError()` flushes them with the payload (PII-scrubbed).

```swift
Mushi.shared.addBreadcrumb(category: .uiTap, message: "Tapped Save")
Mushi.shared.addBreadcrumb(
    category: .navigation,
    level: .info,
    message: "Settings → Profile",
    data: ["from": "home"]
)

let crumbs = Mushi.shared.getBreadcrumbs()  // snapshot for debugging
```

Wire categories: `navigation`, `ui.tap`, `console`, `network`,
`lifecycle`, `custom` — admin tooling treats `ui.tap` as the touch-device
sibling of the web SDK's `ui.click`. The `data` map is `[String: String]`
on iOS; non-string values are coerced to strings on the Capacitor bridge.

If your app already uses Sentry, keep initializing Sentry in the host app and
attach Mushi report metadata through `setMetadata` or `report(..., metadata:)`.
The standalone Swift package no longer ships a separate `MushiMushiSentry`
target, which keeps the native SDK dependency-free by default.

## Configuration

| Field                   | Default                              | Notes |
|-------------------------|--------------------------------------|-------|
| `projectId`             | _required_                           | Project UUID from Mushi admin |
| `apiKey`                | _required_                           | Public ingest key (`mush_pk_...`) |
| `endpoint`              | `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api`         | Override for self-hosting |
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
