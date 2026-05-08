import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;

import 'config.dart';
import 'offline_queue.dart';

/// HTTP client for submitting reports. Scrubs PII from description before
/// sending. On any non-2xx (or transport error), the payload is enqueued to
/// [OfflineQueue] for later flushing with retry+jitter — mirrors the JS core
/// SDK behaviour for cross-platform parity.
class ApiClient {
  ApiClient({
    required this.config,
    required this.queue,
    http.Client? client,
    this.onSubmitted,
  }) : _client = client ?? http.Client();

  final MushiConfig config;
  final OfflineQueue queue;
  final void Function(Map<String, dynamic> payload)? onSubmitted;
  final http.Client _client;

  Uri get _reportsUri => Uri.parse('${config.endpoint}/v1/reports');

  Map<String, String> get _headers => <String, String>{
        'Content-Type': 'application/json',
        'X-Mushi-Api-Key': config.apiKey,
      };

  Future<void> submitReport(Map<String, dynamic> report) async {
    final payload = <String, dynamic>{
      ...report,
      'projectId': config.projectId,
      'sdkName': MushiInfo.sdkName,
      'sdkVersion': MushiInfo.sdkVersion,
    };

    // Added: PII scrubbing (Phase 2.4)
    if (payload['description'] is String) {
      payload['description'] = _scrubPii(payload['description'] as String);
    }

    // Added: retry+jitter (Phase 2.4)
    try {
      await _sendWithRetry(jsonEncode(payload));
      onSubmitted?.call(payload);
    } catch (_) {
      await queue.enqueue(payload);
    }
  }

  /// Best-effort flush of the offline queue with retry+jitter. Stops on
  /// first unrecoverable failure.
  Future<void> flushQueue({int maxBatch = 25}) async {
    final batch = await queue.peek(limit: maxBatch);
    if (batch.isEmpty) return;
    var delivered = 0;
    for (final payload in batch) {
      try {
        await _sendWithRetry(jsonEncode(payload));
        delivered++;
      } catch (_) {
        break;
      }
    }
    if (delivered > 0) await queue.clearDelivered(delivered);
  }

  // Added: retry+jitter (Phase 2.4)
  Future<void> _sendWithRetry(String data, {int attempt = 0}) async {
    final response = await _client.post(
      _reportsUri,
      headers: _headers,
      body: data,
    );
    if ((response.statusCode == 429 || response.statusCode >= 500) &&
        attempt < 3) {
      final delay = Duration(
        milliseconds:
            min(1000 * (1 << attempt) + Random().nextInt(500), 10000),
      );
      await Future<void>.delayed(delay);
      await _sendWithRetry(data, attempt: attempt + 1);
      return;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('HTTP ${response.statusCode}');
    }
  }

  // Added: PII scrubbing (Phase 2.4)
  String _scrubPii(String text) {
    return text
        .replaceAll(
          RegExp(r'[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}'),
          '[REDACTED]',
        )
        .replaceAll(
          RegExp(r'\b\d{3}[.\-]?\d{3}[.\-]?\d{4}\b'),
          '[REDACTED]',
        )
        .replaceAll(
          RegExp(r'\b(?:\d{4}[\s\-]?){3}\d{4}\b'),
          '[REDACTED]',
        );
  }
}
