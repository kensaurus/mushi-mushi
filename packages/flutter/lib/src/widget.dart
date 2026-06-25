import 'package:flutter/material.dart';

import 'config.dart';

/// Bottom sheet for collecting a free-form bug description plus a category
/// tag. Mirrors the iOS `MushiWidgetController` and Android
/// `MushiBottomSheet` widgets.
class MushiReportSheet extends StatefulWidget {
  const MushiReportSheet({
    super.key,
    required this.config,
    required this.onSubmit,
    this.attachedScreenshot,
  });

  final MushiConfig config;
  final String? attachedScreenshot;
  final void Function(Map<String, dynamic>) onSubmit;

  static Future<void> show(
    BuildContext context, {
    required MushiConfig config,
    required void Function(Map<String, dynamic>) onSubmit,
    String? screenshot,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: config.theme.dark ? Colors.black : Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => MushiReportSheet(
        config: config,
        attachedScreenshot: screenshot,
        onSubmit: onSubmit,
      ),
    );
  }

  @override
  State<MushiReportSheet> createState() => _MushiReportSheetState();
}

class _MushiReportSheetState extends State<MushiReportSheet> {
  final _controller = TextEditingController();
  static const _categories = ['bug', 'slow', 'visual', 'confusing'];
  String _category = _categories.first;

  bool get _valid =>
      _controller.text.length >= widget.config.minDescriptionLength;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    final payload = <String, dynamic>{
      'description': _controller.text,
      'category': _category,
    };
    if (widget.attachedScreenshot != null) {
      payload['screenshot'] = widget.attachedScreenshot;
    }
    widget.onSubmit(payload);
    Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final cfg = widget.config;
    final accent = cfg.theme.accentColor;
    final isDark = cfg.theme.resolvedDark(context);
    final textColor = isDark ? Colors.white : Colors.black87;
    final subColor = isDark ? const Color(0xFF8E8E93) : const Color(0xFF8E8E93);
    final cardColor =
        isDark ? const Color(0xFF2C2C2E) : const Color(0xFFF2F2F7);

    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        // Use viewInsets.bottom to lift content above the keyboard on both
        // iOS and Android. The +20 adds a comfortable breathing gap.
        bottom: MediaQuery.of(context).viewInsets.bottom + 20,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Report a bug',
              style: TextStyle(
                color: textColor,
                fontWeight: FontWeight.w600,
                fontSize: 18,
              ),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              children: _categories.map((c) {
                final selected = c == _category;
                return ChoiceChip(
                  label: Text(c,
                      style: TextStyle(
                        color: selected ? Colors.white : textColor,
                      )),
                  selected: selected,
                  selectedColor: accent,
                  backgroundColor: cardColor,
                  onSelected: (_) => setState(() => _category = c),
                );
              }).toList(),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _controller,
              maxLines: 5,
              minLines: 3,
              style: TextStyle(color: textColor),
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                hintText:
                    'What went wrong? (${cfg.minDescriptionLength}+ characters)',
                hintStyle: TextStyle(color: subColor),
                border: OutlineInputBorder(
                  borderSide: BorderSide(color: subColor.withOpacity(0.35)),
                ),
                filled: true,
                fillColor: cardColor,
              ),
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: accent,
                  disabledBackgroundColor: accent.withOpacity(0.3),
                  disabledForegroundColor: isDark
                      ? const Color(0xFF636366)
                      : const Color(0xFF8E8E93),
                ),
                onPressed: _valid ? _submit : null,
                child: const Text('Submit'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
