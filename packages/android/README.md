# Mushi Mushi Android SDK

Native Kotlin SDK for Android applications.

## Installation

Add the dependency to your `build.gradle.kts`:

```kotlin
dependencies {
    implementation("dev.mushimushi:mushi-android:0.1.0")
}
```

## Usage

```kotlin
import dev.mushimushi.Mushi
import dev.mushimushi.MushiConfig

// Initialize in your Application class
Mushi.init(
    context = this,
    config = MushiConfig(
        projectId = "proj_xxx",
        apiKey = "mushi_xxx"
    )
)

// Submit a report programmatically
Mushi.report(
    description = "Button doesn't respond",
    category = "bug"
)
```

## Features

- Shake-to-report gesture detection
- Automatic device info capture
- Screenshot capture
- Offline queue with retry

## Status

Early development — API may change.

## License

[MIT](./LICENSE)
