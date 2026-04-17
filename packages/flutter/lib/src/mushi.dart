import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/widgets.dart';
import 'package:sensors_plus/sensors_plus.dart';

import 'api_client.dart';
import 'config.dart';
import 'device_context.dart';
import 'offline_queue.dart';
import 'screenshot.dart';
import 'widget.dart';

/// Public entry point for the Flutter SDK. Mirrors the surface of the iOS,
/// Android, and JS SDKs so cross-platform docs stay accurate.
class Mushi {
  Mushi._();
  static final Mushi instance = Mushi._();

  MushiConfig? _config;
  ApiClient? _api;
  OfflineQueue? _queue;
  Timer? _flushTimer;
  StreamSubscription<AccelerometerEvent>? _accelSub;
  DateTime _lastShake = DateTime.fromMillisecondsSinceEpoch(0);

  /// Optional: globalKey for the [RepaintBoundary] wrapping the app — used
  /// to capture screenshots without going through platform channels.
  GlobalKey? screenshotBoundaryKey;

  /// The most recently mounted [BuildContext]. Set this from your top-level
  /// widget (e.g. via `MaterialApp.builder`) so shake-to-report can locate a
  /// `Navigator` for presenting the modal.
  BuildContext? rootContext;

  /// Callback fired after every successful report submission. Used by the
  /// optional Sentry bridge to mirror reports into Sentry's UserFeedback.
  void Function(Map<String, dynamic> payload)? onReportSubmitted;

  void configure(MushiConfig config) {
    _config = config;
    _queue = OfflineQueue(maxBytes: config.offlineQueueMaxBytes);
    _api = ApiClient(
      config: config,
      queue: _queue!,
      onSubmitted: (p) => onReportSubmitted?.call(p),
    );
    _installShakeIfNeeded();
    _startFlushTimer();
  }

  Future<void> report({
    required String description,
    String category = 'bug',
    Map<String, dynamic>? metadata,
  }) async {
    final cfg = _config;
    final api = _api;
    if (cfg == null || api == null) return;

    final payload = <String, dynamic>{
      'description': description,
      'category': category,
      'context': await DeviceContext.capture(),
    };
    if (metadata != null) payload['metadata'] = metadata;

    if (cfg.captureScreenshot && screenshotBoundaryKey != null) {
      final shot = await ScreenshotCapture.captureBoundary(screenshotBoundaryKey!);
      if (shot != null) payload['screenshot'] = shot;
    }

    await api.submitReport(payload);
  }

  Future<void> captureError(Object error, [StackTrace? trace]) {
    return report(
      description: error.toString(),
      category: 'bug',
      metadata: <String, dynamic>{
        'errorType': error.runtimeType.toString(),
        if (trace != null) 'stackTrace': trace.toString(),
      },
    );
  }

  /// Programmatically present the bottom sheet. Pass the same `BuildContext`
  /// you'd use for `Navigator.of(context)`.
  Future<void> showWidget(BuildContext context) async {
    final cfg = _config;
    final api = _api;
    if (cfg == null || api == null) return;
    final shot = (cfg.captureScreenshot && screenshotBoundaryKey != null)
        ? await ScreenshotCapture.captureBoundary(screenshotBoundaryKey!)
        : null;
    if (!context.mounted) return;
    await MushiReportSheet.show(
      context,
      config: cfg,
      screenshot: shot,
      onSubmit: (payload) async {
        payload['context'] = await DeviceContext.capture();
        await api.submitReport(payload);
      },
    );
  }

  void _installShakeIfNeeded() {
    final cfg = _config;
    if (cfg == null) return;
    _accelSub?.cancel();
    if (cfg.triggerMode != MushiTriggerMode.shake &&
        cfg.triggerMode != MushiTriggerMode.both) {
      return;
    }
    // We use the raw accelerometer (gravity-included) — same source as
    // Android's TYPE_ACCELEROMETER, which the native ShakeDetector reads.
    // The userAccelerometer stream subtracts gravity (~1g at rest), which would
    // require ~60% more force to clear the same 2.7g threshold and break parity
    // with the Android SDK. iOS uses UIEvent.motionShake (a system gesture),
    // not a g-force threshold, so it isn't part of this comparison.
    _accelSub = accelerometerEventStream().listen((evt) {
      final g = math.sqrt(evt.x * evt.x + evt.y * evt.y + evt.z * evt.z) / 9.81;
      if (g < 2.7) return;
      final now = DateTime.now();
      if (now.difference(_lastShake).inMilliseconds < 1000) return;
      _lastShake = now;
      final ctx = rootContext;
      if (ctx != null && ctx.mounted) showWidget(ctx);
    });
  }

  void _startFlushTimer() {
    _flushTimer?.cancel();
    _flushTimer = Timer.periodic(
      const Duration(seconds: 30),
      (_) => _api?.flushQueue(),
    );
    unawaited(_api?.flushQueue() ?? Future<void>.value());
  }
}
