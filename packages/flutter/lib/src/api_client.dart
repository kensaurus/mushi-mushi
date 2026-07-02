import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;

import 'config.dart';
import 'offline_queue.dart';
import 'pii_patterns.g.dart';

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

    // PII scrubbing — applied to every free-text vector that can pick up
    // user-pasted secrets. Mirrors packages/core/src/pii-scrubber.ts so
    // server-side and SDK-side redaction stay in lockstep.
    if (payload['description'] is String) {
      payload['description'] = _scrubPii(payload['description'] as String);
    }
    if (payload['summary'] is String) {
      payload['summary'] = _scrubPii(payload['summary'] as String);
    }
    if (payload['breadcrumbs'] is List) {
      payload['breadcrumbs'] = (payload['breadcrumbs'] as List).map((c) {
        if (c is Map && c['message'] is String) {
          return <String, dynamic>{
            ...Map<String, dynamic>.from(c),
            'message': _scrubPii(c['message'] as String),
          };
        }
        return c;
      }).toList();
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
        milliseconds: min(1000 * (1 << attempt) + Random().nextInt(500), 10000),
      );
      await Future<void>.delayed(delay);
      await _sendWithRetry(data, attempt: attempt + 1);
      return;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('HTTP ${response.statusCode}');
    }
  }

  // PII scrubbing — Wave S2 / D-16
  //
  // Patterns live in pii_patterns.g.dart, generated from the single source of
  // truth shared with packages/core/src/pii-scrubber.ts (see
  // packages/core/src/pii-patterns.json) so the JS and Flutter SDKs can't
  // drift. Order matters: high-entropy / high-cost tokens first so generic
  // email/phone regex never wins a tie. IPv4/IPv6 are omitted by default
  // (too noisy: `192.168.1.1` is rarely PII).
  String _scrubPii(String text) {
    var result = text;
    for (final entry in kPiiScrubPatterns) {
      result = result.replaceAll(entry.key, entry.value);
    }
    return result;
  }

  /// Reporter inbox — list reports filed from this device's reporter token.
  /// Requires HMAC reporter auth (wired via core SDK in web/Capacitor builds).
  Future<List<Map<String, dynamic>>> listReporterReports({
    required String reporterToken,
    required String reporterHmac,
  }) async {
    final uri = Uri.parse('${config.endpoint}/v1/reporter/reports');
    final res = await _client.get(
      uri,
      headers: {
        ..._headers,
        'X-Mushi-Reporter-Token': reporterToken,
        'X-Mushi-Reporter-Signature': reporterHmac,
      },
    );
    if (res.statusCode < 200 || res.statusCode >= 300) return [];
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    final data = body['data'] as Map<String, dynamic>?;
    return (data?['reports'] as List<dynamic>? ?? [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
  }

  /// Reporter-initiated regression reopen.
  Future<Map<String, dynamic>?> reopenReporterReport({
    required String reportId,
    required String reporterToken,
    required String reporterHmac,
    String? note,
  }) async {
    final uri = Uri.parse(
      '${config.endpoint}/v1/reporter/reports/$reportId/reopen',
    );
    final res = await _client.post(
      uri,
      headers: {
        ..._headers,
        'X-Mushi-Reporter-Token': reporterToken,
        'X-Mushi-Reporter-Signature': reporterHmac,
      },
      body: jsonEncode({'note': note ?? ''}),
    );
    if (res.statusCode < 200 || res.statusCode >= 300) return null;
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    return body['data'] as Map<String, dynamic>?;
  }
}
