# Mushi Mushi iOS SDK

Native Swift SDK for iOS applications.

## Installation

### Swift Package Manager

Add to your `Package.swift`:

```swift
dependencies: [
    .package(url: "https://github.com/kensaurus/mushi-mushi.git", from: "0.1.0")
]
```

Or in Xcode: File → Add Package Dependencies → paste the repo URL.

## Usage

```swift
import Mushi

// Initialize in AppDelegate or @main App
Mushi.configure(
    projectId: "proj_xxx",
    apiKey: "mushi_xxx"
)

// Submit a report
Mushi.report(
    description: "Layout breaks on iPad",
    category: .visual
)
```

## Features

- Shake-to-report gesture
- Automatic device info capture
- Screenshot capture
- Offline queue

## Status

Early development — API may change.

## License

[MIT](./LICENSE)
