# Mushi Mushi for Flutter (`mushi_mushi`)

> **Your AI wrote it. Mushi Mushi tells you why it broke.**

The Flutter SDK for [Mushi Mushi](https://kensaur.us/mushi-mushi), for iOS and
Android apps built with Flutter whose users find bugs you never see. A user
shakes the phone or taps a button, describes the problem, and the report
arrives in Mushi Mushi with a screenshot and device details, where it gets a
plain-English diagnosis and a fix prompt for your AI editor.

> **Status: preview (0.3.0), not on pub.dev yet.** `flutter pub add mushi_mushi`
> and `mushi_mushi: ^0.3.0` will not resolve. Install it from this repository
> as a git dependency (below) until the pub.dev release lands.

You need a Mushi Mushi project: its project ID and an SDK API key
(`mushi_…`) from the console. The free plan works. Flutter 3.19 or newer.

Docs: [Flutter SDK reference](https://kensaur.us/mushi-mushi/docs/sdks/flutter) ·
[Flutter quickstart](https://kensaur.us/mushi-mushi/docs/quickstart/flutter)

## Features

- **Shake-to-report** via `sensors_plus`, on iOS and Android
- **Offline queue** that survives app restarts (file-backed, size-capped)
- **Material bottom-sheet widget** with a category picker and a minimum
  description length
- **Device and app context** attached via `device_info_plus` and
  `package_info_plus`
- **Optional Sentry hook** via `Mushi.instance.onReportSubmitted`

## Install

```yaml
dependencies:
  mushi_mushi:
    git:
      url: https://github.com/kensaurus/mushi-mushi.git
      path: packages/flutter
      # ref: <commit-sha>   # pin a commit for reproducible builds
```

Then run `flutter pub get`.

## Quickstart

```dart
import 'package:flutter/material.dart';
import 'package:mushi_mushi/mushi_mushi.dart';

void main() {
  Mushi.instance.configure(const MushiConfig(
    projectId: '<project-uuid>',
    apiKey: 'mushi_...',
    endpoint: 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api',
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

## Sending reports to Sentry too

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
| `projectId`            | _required_                           | Project UUID from the Mushi Mushi console |
| `apiKey`               | _required_                           | Project API key (`mushi_...`) |
| `endpoint`             | _required_                           | Mushi Mushi Cloud: `https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api`; self-hosters pass their own functions URL |
| `triggerMode`          | `shake`                              | `shake` / `button` / `both` / `none` |
| `captureScreenshot`    | `true`                               | Requires a `RepaintBoundary` boundary key |
| `minDescriptionLength` | `20`                                 | Matches the web SDK contract |
| `offlineQueueMaxBytes` | `2 * 1024 * 1024`                    | Soft cap; oldest entries trim first |
| `theme`                | `MushiTheme(accentColor: Color(0xFF22C55E))` | |
| `triggerInsets`        | `MushiTriggerInsets(right: 20, bottom: 28)` | Per-edge offset for the in-app `MushiFloatingTrigger` overlay (see `lib/src/overlay.dart`). Set `left` to `0` to anchor on the leading edge instead. |

## Privacy

- The SDK never logs secrets, tokens, or full request bodies.
- Screenshots are captured only when `captureScreenshot == true` and a
  `screenshotBoundaryKey` is provided.
- The offline queue lives in your app's support directory and is removed
  when the app is uninstalled.

## License

MIT. See [LICENSE](./LICENSE).
