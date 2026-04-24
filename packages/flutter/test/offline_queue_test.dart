import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:mushi_mushi/src/offline_queue.dart';

void main() {
  late Directory tmp;
  late File file;

  setUp(() {
    tmp = Directory.systemTemp.createTempSync('mushi_test_');
    file = File('${tmp.path}/queue.ndjson');
  });

  tearDown(() {
    if (tmp.existsSync()) tmp.deleteSync(recursive: true);
  });

  test('enqueue, peek, clear', () async {
    final q = OfflineQueue(maxBytes: 100000, file: file);
    await q.enqueue({'description': 'hello', 'category': 'bug'});
    await q.enqueue({'description': 'world', 'category': 'slow'});

    expect(await q.count(), 2);
    final peeked = await q.peek(limit: 10);
    expect(peeked.length, 2);
    expect(peeked.first['description'], 'hello');

    await q.clearDelivered(1);
    expect(await q.count(), 1);
  });

  test('trims oldest when over byte budget', () async {
    final q = OfflineQueue(maxBytes: 250, file: file);
    for (var i = 0; i < 10; i++) {
      await q.enqueue({'description': 'report-$i', 'category': 'bug'});
    }
    // Matches iOS/Android contract: each ~44 B NDJSON line, 250 B cap
    // ⇒ five newest rows survive after trimming the five oldest.
    expect(await q.count(), 5);
    expect((await q.peek(limit: 1)).first['description'], 'report-5');
  });
}
