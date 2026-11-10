# Bug report widget for Flutter

Source: https://kensaur.us/mushi-mushi/docs/quickstart/flutter

---
title: Bug report widget for Flutter
description: "Free, open-source bug report widget for Flutter (preview): shake-to-report, a Material bottom sheet and an offline queue. A git dependency, not on pub.dev yet."
---

# Bug report widget for Flutter

This quickstart adds the Mushi Mushi shake-to-report widget to a Flutter app
for iOS and Android.

  **Preview, not on pub.dev yet.** A plain version constraint for `mushi_mushi`
  will not resolve until the package is published. Until then, depend on it straight from the
  repository with a `git:` dependency, as below. `npx mushi-mushi` does not set
  up Flutter projects.

## Get your project ID and API key

The SDK needs two values from a Mushi Mushi project.

- **By hand:** [create a free account](https://kensaur.us/mushi-mushi/admin/signup?src=quickstart-flutter)
  (no card) and create a project. The panel that opens shows the **project ID**
  and an **API key** that starts with `mushi_`. Copy the key now: it is shown
  once. You can mint another under **Set up → Test it → Generate API key**.
- **Self-hosting?** Your own console gives you the same two values. See
  [Self-hosting](/self-hosting).

They go into the config in the Initialize step below.

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
