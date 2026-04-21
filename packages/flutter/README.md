# mushi_mushi

[![pub package](https://img.shields.io/pub/v/mushi_mushi.svg)](https://pub.dev/packages/mushi_mushi)

Flutter SDK for [Mushi Mushi](https://mushimushi.dev) — the open-source,
LLM-driven bug intake, classification, and autofix platform.

> **Status**: V0.2.0 Surface stable; minor changes still possible
> before V1.0.

## Features

- 📳 **Shake-to-report** via `sensors_plus` — works on iOS & Android
- 📦 **Offline queue** that survives app restarts (file-backed, byte-capped)
- 🎯 **Material bottom-sheet widget** with category picker and live
  min-length validation
- 🌐 **Device + app context** auto-attached via `device_info_plus` and
  `package_info_plus`
- 🔌 **Optional Sentry bridge** via `Mushi.instance.onReportSubmitted`

## Install

```yaml
dependencies:
  mushi_mushi: ^0.2.0
```

## Quickstart

```dart
import 'package:flutter/material.dart';
import 'package:mushi_mushi/mushi_mushi.dart';

void main() {
  Mushi.instance.configure(const MushiConfig(
    projectId: 'proj_...',
    apiKey: 'mush_pk_...',
    triggerMode: MushiTriggerMode.both,
    captureScreenshot: true,
    minDescriptionLength: 20,
  ));
  runApp(const MyApp());
}

final mushiBoundary = GlobalKey();

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    Mushi.instance.screenshotBoundaryKey = mushiBoundary;
    return MaterialApp(
      builder: (ctx, child) {
        Mushi.instance.rootContext = ctx;
        return RepaintBoundary(key: mushiBoundary, child: child);
      },
      home: HomeScreen(),
    );
  }
}
```

To present the widget programmatically:

```dart
ElevatedButton(
  onPressed: () => Mushi.instance.showWidget(context),
  child: const Text('Report a bug'),
);
```

To fire a report from code (no UI):

```dart
await Mushi.instance.report(
  description: 'Profile photo upload spinner never stops on tablets',
  category: 'bug',
);

try { await riskyCall(); }
catch (e, st) { await Mushi.instance.captureError(e, st); }
```

## Sentry bridge

The Flutter SDK exposes an `onReportSubmitted` callback you can wire to any
crash reporter. For Sentry:

```dart
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:mushi_mushi/mushi_mushi.dart';

await SentryFlutter.init((o) => o.dsn = 'https://...sentry.io/0');
Mushi.instance.configure(const MushiConfig(/* ... */));
Mushi.instance.onReportSubmitted = (payload) async {
  final desc = payload['description']?.toString();
  if (desc == null || desc.isEmpty) return;
  final id = await Sentry.captureMessage('MushiReport: ${desc.substring(0, desc.length.clamp(0, 80))}');
  await Sentry.captureUserFeedback(SentryUserFeedback(eventId: id, comments: desc));
};
```

## Configuration

| Field                  | Default                              | Notes |
|------------------------|--------------------------------------|-------|
| `projectId`            | _required_                           | Project UUID from Mushi admin |
| `apiKey`               | _required_                           | Public ingest key (`mush_pk_...`) |
| `endpoint`             | `https://api.mushimushi.dev`         | Override for self-hosting |
| `triggerMode`          | `shake`                              | `shake` / `button` / `both` / `none` |
| `captureScreenshot`    | `true`                               | Requires a `RepaintBoundary` boundary key |
| `minDescriptionLength` | `20`                                 | Matches the web SDK contract |
| `offlineQueueMaxBytes` | `2 * 1024 * 1024`                    | Soft cap; oldest entries trim first |
| `theme`                | `MushiTheme(accentColor: Color(0xFF22C55E))` | |

## Privacy

- The SDK never logs secrets, tokens, or full request bodies.
- Screenshots are captured only when `captureScreenshot == true` and a
  `screenshotBoundaryKey` is provided.
- The offline queue lives in your app's support directory and is removed
  when the app is uninstalled.

## License

MIT — see [LICENSE](../../LICENSE) at the repo root.
