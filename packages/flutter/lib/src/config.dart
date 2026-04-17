import 'package:flutter/material.dart';

/// How the SDK auto-presents the report widget.
enum MushiTriggerMode { shake, button, both, none }

/// Theme overrides for the bottom sheet.
@immutable
class MushiTheme {
  const MushiTheme({
    this.accentColor = const Color(0xFF22C55E),
    this.dark = false,
  });

  final Color accentColor;
  final bool dark;
}

/// Top-level configuration. Mirrors the iOS/Android/JS SDK shape.
@immutable
class MushiConfig {
  const MushiConfig({
    required this.projectId,
    required this.apiKey,
    this.endpoint = defaultEndpoint,
    this.triggerMode = MushiTriggerMode.shake,
    this.captureScreenshot = true,
    this.captureBreadcrumbs = true,
    this.minDescriptionLength = 20,
    this.offlineQueueMaxBytes = 2 * 1024 * 1024,
    this.theme = const MushiTheme(),
  });

  static const String defaultEndpoint = 'https://api.mushimushi.dev';

  final String projectId;
  final String apiKey;
  final String endpoint;
  final MushiTriggerMode triggerMode;
  final bool captureScreenshot;
  final bool captureBreadcrumbs;
  final int minDescriptionLength;
  final int offlineQueueMaxBytes;
  final MushiTheme theme;
}

/// Compile-time SDK metadata. Update on version bump.
class MushiInfo {
  static const String sdkName = '@mushi-mushi/flutter';
  static const String sdkVersion = '0.2.0';
}
