# Changelog

## 0.3.0

- Version aligned with the Mushi Mushi 1.21 SDK release wave.
- Tooling hygiene: sources now pass `dart format` and a clean `dart analyze`
  (removed an unnecessary cast in `api_client.dart` and an unused `dart:math`
  import in `overlay.dart`) to restore pub.dev static-analysis scoring.

## 0.2.0

- Initial pub.dev release as part of Mushi Mushi C3.
- Pure-Dart implementation: HTTP transport via `package:http`, file-backed
  offline queue, shake-to-report via `sensors_plus`, screenshot via
  `RepaintBoundary`, device context via `device_info_plus`/`package_info_plus`.
- Native plugin scaffolding for iOS and Android reserves the
  `dev.mushimushi.flutter` method channel for future native-only features.
- Material bottom-sheet widget with category picker and live min-length
  validation.
- Optional Sentry bridge via `Mushi.instance.onReportSubmitted`.
