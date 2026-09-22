# Flutter quickstart

Source: https://kensaur.us/mushi-mushi/docs/quickstart/flutter

---
title: Flutter quickstart
description: Add Mushi's Flutter SDK as a git dependency — shake-to-report, a Material bottom sheet and an offline queue for iOS and Android. Preview, not on pub.dev yet.
---

# Flutter quickstart

  **Preview — not on pub.dev yet.** A plain version constraint for `mushi_mushi`
  will not resolve until the package is published. Until then, depend on it straight from the
  repository with a `git:` dependency, as below. `npx mushi-mushi` does not set
  up Flutter projects.

## Install

```yaml filename="pubspec.yaml"
dependencies:
  mushi_mushi:
    git:
      url: https://github.com/kensaurus/mushi-mushi.git
      path: packages/flutter
      ref: master
```

Then run `flutter pub get`. Pin `ref:` to a commit SHA if you want repeatable builds.

## Initialize

`endpoint` is required: use the hosted API below, or your own if you self-host.

```dart filename="lib/main.dart"
import 'package:flutter/material.dart';
import 'package:mushi_mushi/mushi_mushi.dart';

final mushiBoundary = GlobalKey();

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  Mushi.instance.configure(const MushiConfig(
    projectId: 'YOUR_PROJECT_ID',
    apiKey: 'mushi_...',
    endpoint: 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api',
    triggerMode: MushiTriggerMode.shake, // shake | button | both | none
  ));
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    // Screenshots are captured from this boundary.
    Mushi.instance.screenshotBoundaryKey = mushiBoundary;
    return MaterialApp(
      builder: (ctx, child) {
        Mushi.instance.rootContext = ctx;
        return RepaintBoundary(key: mushiBoundary, child: child);
      },
      home: const HomeScreen(),
    );
  }
}
```

## Open the widget or submit a report

```dart
// Present the bottom sheet from any screen
ElevatedButton(
  onPressed: () => Mushi.instance.showWidget(context),
  child: const Text('Report a bug'),
);

// File a report from code, no UI
await Mushi.instance.report(
  description: 'Bottom nav cuts off on iPhone SE',
  category: 'bug',
);

// Forward a caught error
try {
  await riskyCall();
} catch (e, st) {
  await Mushi.instance.captureError(e, st);
}
```

Full API: [`mushi_mushi` (Flutter)](/sdks/flutter).
