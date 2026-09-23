# mushi_mushi (Flutter)

Source: https://kensaur.us/mushi-mushi/docs/sdks/flutter

---
title: 'mushi_mushi (Flutter)'
description: API reference for mushi_mushi, Mushi's Flutter SDK — configure, report, captureError, showWidget, screenshots and the offline queue. Preview, not on pub.dev.
---

# `mushi_mushi` (Flutter)

Pure-Dart SDK for iOS and Android: `RepaintBoundary` screenshot capture, shake
detection via `sensors_plus`, a Material bottom sheet, and a byte-capped
offline queue.

  **Preview — not on pub.dev yet.** Install it as a `git:` dependency from the
  repository until the first release is published.

```yaml
# pubspec.yaml
dependencies:
  mushi_mushi:
    git:
      url: https://github.com/kensaurus/mushi-mushi.git
      path: packages/flutter
      ref: master
```

See [Quickstart → Flutter](/quickstart/flutter) for the full setup walkthrough.

## API surface

| Member | Purpose |
| --- | --- |
| `Mushi.instance.configure(MushiConfig)` | Boot the SDK — call once in `main()` before `runApp()` |
| `Mushi.instance.report(description:, category:, metadata:)` | Submit a report from code |
| `Mushi.instance.captureError(error, [stackTrace])` | Report a caught error with its type and stack trace |
| `Mushi.instance.showWidget(context)` | Present the bottom sheet from any screen |
| `Mushi.instance.screenshotBoundaryKey` | `GlobalKey` of the `RepaintBoundary` screenshots are taken from |
| `Mushi.instance.rootContext` / `setRootContext(context)` | Context used by shake-to-report to present the sheet |
| `Mushi.instance.onReportSubmitted` | Callback after each successful submission (use it to mirror reports into Sentry) |

## Configuration

`MushiConfig` requires `projectId`, `apiKey` and `endpoint` (the hosted API is
`https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api`). Optional fields:
`triggerMode` (`shake`, `button`, `both`, `none`; default `shake`),
`captureScreenshot`, `minDescriptionLength` (default 20),
`offlineQueueMaxBytes` (default 2 MB), `theme` and `triggerInsets`.

## Submitting a report

```dart
await Mushi.instance.report(
  description: 'The checkout button does nothing.',
  category: 'bug',
  metadata: {'screen': 'checkout'},
);
```

## Screenshot capture

The SDK captures the widget tree under `screenshotBoundaryKey` into a PNG
before submission. No boundary key, no screenshot; set
`captureScreenshot: false` to turn it off entirely.

## Offline queue

Reports that fail to send are written to a file in the app's support
directory and retried every 30 seconds and whenever connectivity returns. The
queue is capped by `offlineQueueMaxBytes`; the oldest entries are trimmed
first.
