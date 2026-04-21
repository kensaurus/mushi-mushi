# Changelog

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
