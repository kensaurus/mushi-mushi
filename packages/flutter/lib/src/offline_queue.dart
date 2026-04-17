import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:path_provider/path_provider.dart';

/// Append-only file-backed queue that survives app restarts. Mirrors the
/// behaviour of the iOS `OfflineQueue` and the JS core SDK so the contract
/// is identical across platforms.
class OfflineQueue {
  OfflineQueue({required this.maxBytes, File? file}) : _file = file;

  final int maxBytes;
  File? _file;
  final _lock = _AsyncLock();

  Future<File> _resolveFile() async {
    if (_file != null) return _file!;
    final dir = await getApplicationSupportDirectory();
    final mushiDir = Directory('${dir.path}/MushiMushi');
    if (!mushiDir.existsSync()) mushiDir.createSync(recursive: true);
    return _file = File('${mushiDir.path}/queue.ndjson');
  }

  Future<void> enqueue(Map<String, dynamic> payload) => _lock.run(() async {
    final f = await _resolveFile();
    final line = utf8.encode('${jsonEncode(payload)}\n');
    var bytes = f.existsSync() ? await f.readAsBytes() : Uint8List(0);
    bytes = Uint8List.fromList([...bytes, ...line]);
    while (bytes.length > maxBytes) {
      final nl = bytes.indexOf(0x0A);
      if (nl < 0) break;
      bytes = bytes.sublist(nl + 1);
    }
    await f.writeAsBytes(bytes, flush: true);
  });

  Future<List<Map<String, dynamic>>> peek({int limit = 25}) => _lock.run(() async {
    final f = await _resolveFile();
    if (!f.existsSync()) return <Map<String, dynamic>>[];
    final lines = (await f.readAsString())
        .split('\n')
        .where((l) => l.isNotEmpty)
        .take(limit);
    return lines
        .map((l) {
          try {
            final decoded = jsonDecode(l);
            return decoded is Map<String, dynamic> ? decoded : null;
          } catch (_) {
            return null;
          }
        })
        .whereType<Map<String, dynamic>>()
        .toList();
  });

  Future<void> clearDelivered(int count) => _lock.run(() async {
    if (count <= 0) return;
    final f = await _resolveFile();
    if (!f.existsSync()) return;
    final remaining = (await f.readAsString())
        .split('\n')
        .where((l) => l.isNotEmpty)
        .skip(count)
        .toList();
    if (remaining.isEmpty) {
      await f.delete();
    } else {
      await f.writeAsString('${remaining.join('\n')}\n', flush: true);
    }
  });

  Future<int> count() => _lock.run(() async {
    final f = await _resolveFile();
    if (!f.existsSync()) return 0;
    return (await f.readAsString())
        .split('\n')
        .where((l) => l.isNotEmpty)
        .length;
  });
}

class _AsyncLock {
  Future<void> _last = Future.value();

  Future<T> run<T>(Future<T> Function() fn) {
    final completer = Completer<T>();
    final next = _last.then((_) => fn()).then(
          completer.complete,
          onError: completer.completeError,
        );
    _last = next.catchError((_) {});
    return completer.future;
  }
}
