import 'package:flutter/material.dart';

import 'config.dart';

class MushiFloatingTrigger extends StatelessWidget {
  const MushiFloatingTrigger({
    super.key,
    required this.config,
    required this.onPressed,
  });

  final MushiConfig config;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final theme = config.theme;
    final bottomPadding = MediaQuery.paddingOf(context).bottom;
    return Positioned(
      right: config.triggerInsets.left == null ? config.triggerInsets.right : null,
      left: config.triggerInsets.left,
      bottom: config.triggerInsets.bottom + bottomPadding,
      child: Semantics(
        button: true,
        label: 'Report a bug',
        child: GestureDetector(
          onTap: onPressed,
          child: DecoratedBox(
            decoration: BoxDecoration(
              color:
                  theme.dark ? const Color(0xFF0F0E0C) : const Color(0xFFF8F4ED),
              border: Border.all(color: theme.accentColor.withOpacity(0.35)),
              borderRadius: BorderRadius.circular(4),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x33000000),
                  blurRadius: 14,
                  offset: Offset(0, 6),
                ),
              ],
            ),
            child: SizedBox(
              width: 56,
              height: 56,
              child: Center(
                child: Text(
                  '🐛',
                  style: TextStyle(
                    fontSize: 24,
                    color:
                        theme.dark ? const Color(0xFFF2EBDD) : const Color(0xFF0E0D0B),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
