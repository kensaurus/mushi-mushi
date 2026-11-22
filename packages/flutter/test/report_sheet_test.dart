import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mushi_mushi/src/config.dart';
import 'package:mushi_mushi/src/widget.dart';

/// A 1x1 PNG.
const _png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const _config = MushiConfig(
  projectId: 'p',
  apiKey: 'k',
  endpoint: 'https://example.com',
  minDescriptionLength: 4,
);

Future<List<Map<String, dynamic>>> _pumpSheet(
  WidgetTester tester, {
  String? screenshot,
}) async {
  final sent = <Map<String, dynamic>>[];
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: MushiReportSheet(
          config: _config,
          attachedScreenshot: screenshot,
          onSubmit: sent.add,
        ),
      ),
    ),
  );
  await tester.enterText(find.byType(TextField), 'Checkout is broken');
  await tester.pump();
  return sent;
}

void main() {
  testWidgets('shows the screenshot and sends it when kept', (tester) async {
    final sent = await _pumpSheet(tester, screenshot: _png);

    expect(find.byKey(const Key('mushi-screenshot-preview')), findsOneWidget);
    await tester.tap(find.text('Submit'));
    await tester.pump();

    expect(sent.single['screenshot'], _png);
  });

  testWidgets('Remove drops the screenshot from the report', (tester) async {
    final sent = await _pumpSheet(tester, screenshot: _png);

    await tester.tap(find.byKey(const Key('mushi-screenshot-remove')));
    await tester.pump();
    expect(find.byKey(const Key('mushi-screenshot-preview')), findsNothing);
    await tester.tap(find.text('Submit'));
    await tester.pump();

    expect(sent.single.containsKey('screenshot'), isFalse);
  });

  testWidgets('a screenshot that cannot be shown is not sent', (tester) async {
    final sent = await _pumpSheet(tester, screenshot: 'not base64 %%');

    expect(find.byKey(const Key('mushi-screenshot-preview')), findsNothing);
    await tester.tap(find.text('Submit'));
    await tester.pump();

    expect(sent.single.containsKey('screenshot'), isFalse);
  });
}
