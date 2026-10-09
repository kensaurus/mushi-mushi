# MushiMushi (iOS)

Source: https://kensaur.us/mushi-mushi/docs/sdks/ios

---
title: 'MushiMushi (iOS)'
description: API reference for MushiMushi, Mushi's native Swift SDK — configure, report, captureError, breadcrumbs and PII scrubbing. Preview, via SwiftPM from master.
---

# `MushiMushi` (iOS / macOS / tvOS)

Native Swift SDK with no third-party dependencies.

  **Preview.** Not on CocoaPods and no release tag yet — add the package with
  Swift Package Manager on the `master` branch.

```swift
// Swift Package Manager — Package.swift
.package(url: "https://github.com/kensaurus/mushi-mushi.git", branch: "master")
```

See [Quickstart → iOS](/quickstart/ios) for the full setup walkthrough.

## API surface

| Method | Purpose |
| --- | --- |
| `Mushi.shared.configure(with: MushiConfig(...))` | Boot the SDK — call in `App.init()` or `application(_:didFinishLaunchingWithOptions:)` |
| `Mushi.shared.report(description:category:metadata:)` | Submit a report from code, no UI |
| `Mushi.shared.captureError(_:context:)` | Report a Swift `Error` with its name, message and cause |
| `Mushi.shared.showWidget(category:metadata:)` | Present the bottom-sheet widget |
| `Mushi.shared.setUser(_:)` | Attach app user identity to subsequent reports |
| `Mushi.shared.setMetadata(_:value:)` | Attach or clear a metadata key on subsequent reports |
| `Mushi.shared.addBreadcrumb(category:level:message:data:)` | Add to the 50-entry breadcrumb ring buffer |
| `Mushi.shared.attachTo(_:)` | Open the widget when a `UIControl` is tapped |

## Setup

`MushiConfig` requires `projectId`, `apiKey` and `endpoint`. Everything else
has a default.

```swift
import MushiMushi

Mushi.shared.configure(with: MushiConfig(
    projectId: "YOUR_PROJECT_ID",
    apiKey: "mushi_...",
    endpoint: "https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api",
    triggerMode: .shake,       // .shake | .button | .both | .none
    captureScreenshot: true,
    minDescriptionLength: 20
))
```

## Identifying users

```swift
// After sign-in
Mushi.shared.setUser(["id": user.id, "email": user.email])
```

## Offline queue

Reports that fail to send are appended to
`Application Support/MushiMushi/queue.ndjson`, capped by
`offlineQueueMaxBytes` (oldest entries trimmed first), and flushed on a timer
and when the network comes back.

## Screenshot capture

Screenshots are taken with `UIGraphicsImageRenderer` when `captureScreenshot`
is `true`. Turn it off for flows that show sensitive data.

## Sentry

There is no Sentry bridge in the Swift package. Keep initialising Sentry in the
host app and pass context to Mushi with `setMetadata` or
`report(..., metadata:)`.
