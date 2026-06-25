import 'package:flutter/material.dart';

/// How the SDK auto-presents the report widget.
enum MushiTriggerMode { shake, button, both, none }

/// Theme overrides for the bottom sheet.
@immutable
class MushiTheme {
  const MushiTheme({
    this.accentColor = const Color(0xFF22C55E),
    this.dark = false,
    this.inherit = false,
  });

  final Color accentColor;
  final bool dark;

  /// When true, the SDK reads Brightness from the host app's Theme
  /// and ignores the `dark` field.
  final bool inherit;

  bool resolvedDark(BuildContext context) {
    if (inherit) {
      return Theme.of(context).brightness == Brightness.dark;
    }
    return dark;
  }
}

/// Top-level configuration. Mirrors the iOS/Android/JS SDK shape.
///
/// BREAKING CHANGE: [endpoint] is now required — there is no safe default.
/// Set it to your Supabase Edge Function URL,
/// e.g. `https://xyz.supabase.co/functions/v1/api`.
@immutable
class MushiConfig {
  const MushiConfig({
    required this.projectId,
    required this.apiKey,
    required this.endpoint,
    this.triggerMode = MushiTriggerMode.shake,
    this.captureScreenshot = true,
    this.captureBreadcrumbs = true,
    this.minDescriptionLength = 20,
    this.offlineQueueMaxBytes = 2 * 1024 * 1024,
    this.theme = const MushiTheme(),
    this.triggerInsets = const MushiTriggerInsets(),
    this.draggable = false,
    this.snapToEdge = true,
    this.persistFabPosition = false,
  });

  final String projectId;
  final String apiKey;

  /// Your Supabase Edge Function URL, e.g. `https://xyz.supabase.co/functions/v1/api`.
  final String endpoint;
  final MushiTriggerMode triggerMode;
  final bool captureScreenshot;
  final bool captureBreadcrumbs;
  final int minDescriptionLength;
  final int offlineQueueMaxBytes;
  final MushiTheme theme;
  final MushiTriggerInsets triggerInsets;

  /// Allow the FAB to be dragged to a new position.
  final bool draggable;

  /// Snap the FAB to the nearest vertical edge after dragging.
  final bool snapToEdge;

  /// Persist FAB position across sessions via SharedPreferences.
  final bool persistFabPosition;
}

@immutable
class MushiTriggerInsets {
  const MushiTriggerInsets({
    this.bottom = 28,
    this.left,
    this.right = 20,
  });

  final double bottom;
  final double? left;
  final double? right;
}

/// Compile-time SDK metadata. Update on version bump.
class MushiInfo {
  static const String sdkName = '@mushi-mushi/flutter';
  static const String sdkVersion = '0.3.0';
}
