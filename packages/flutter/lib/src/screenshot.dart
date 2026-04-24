import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

/// Captures a base64 PNG of a widget rendered behind a [RepaintBoundary].
/// Best-effort; returns `null` on any failure.
///
/// To enable widget-tree screenshots, wrap your app in a `RepaintBoundary`
/// with a `GlobalKey` and pass that key here:
///
/// ```dart
/// final mushiBoundary = GlobalKey();
/// MaterialApp(
///   builder: (_, child) => RepaintBoundary(key: mushiBoundary, child: child),
/// );
/// ```
class ScreenshotCapture {
  static Future<String?> captureBoundary(GlobalKey key) async {
    try {
      final boundary =
          key.currentContext?.findRenderObject() as RenderRepaintBoundary?;
      if (boundary == null) return null;
      final ui.Image image = await boundary.toImage(pixelRatio: 1.0);
      final ByteData? byteData = await image.toByteData(
        format: ui.ImageByteFormat.png,
      );
      if (byteData == null) return null;
      return base64Encode(byteData.buffer.asUint8List());
    } catch (_) {
      return null;
    }
  }
}
