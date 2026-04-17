import 'dart:convert';

import 'package:http/http.dart' as http;

import 'config.dart';
import 'offline_queue.dart';

/// HTTP client for submitting reports. On any non-2xx (or transport error),
/// the payload is enqueued to [OfflineQueue] for later flushing — mirrors the
/// JS core SDK behaviour for cross-platform parity.
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

  Future<void> submitReport(Map<String, dynamic> report) async {
    final payload = <String, dynamic>{
      ...report,
      'projectId': config.projectId,
      'sdkName': MushiInfo.sdkName,
      'sdkVersion': MushiInfo.sdkVersion,
    };

    try {
      final res = await _client.post(
        _reportsUri,
        headers: <String, String>{
          'Content-Type': 'application/json',
          'X-Mushi-Api-Key': config.apiKey,
        },
        body: jsonEncode(payload),
      );
      if (res.statusCode < 200 || res.statusCode >= 300) {
        await queue.enqueue(payload);
        return;
      }
      onSubmitted?.call(payload);
    } catch (_) {
      await queue.enqueue(payload);
    }
  }

  /// Best-effort flush of the offline queue. Stops on first failure.
  Future<void> flushQueue({int maxBatch = 25}) async {
    final batch = await queue.peek(limit: maxBatch);
    if (batch.isEmpty) return;
    var delivered = 0;
    for (final payload in batch) {
      try {
        final res = await _client.post(
          _reportsUri,
          headers: <String, String>{
            'Content-Type': 'application/json',
            'X-Mushi-Api-Key': config.apiKey,
          },
          body: jsonEncode(payload),
        );
        if (res.statusCode >= 200 && res.statusCode < 300) {
          delivered++;
        } else {
          break;
        }
      } catch (_) {
        break;
      }
    }
    if (delivered > 0) await queue.clearDelivered(delivered);
  }
}
