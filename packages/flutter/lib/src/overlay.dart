import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'config.dart';

const double _kFabSize = 56.0;
const double _kEdgePad = 12.0;
const String _kPosKey = 'mushi:fab_pos';

/// Draggable, repositionable FAB for the Mushi SDK.
///
/// When [MushiConfig.draggable] is true, users can long-press and drag
/// the button to any screen position. The final position is optionally
/// persisted via SharedPreferences ([MushiConfig.persistFabPosition]).
class MushiFloatingTrigger extends StatefulWidget {
  const MushiFloatingTrigger({
    super.key,
    required this.config,
    required this.onPressed,
  });

  final MushiConfig config;
  final VoidCallback onPressed;

  @override
  State<MushiFloatingTrigger> createState() => _MushiFloatingTriggerState();
}

class _MushiFloatingTriggerState extends State<MushiFloatingTrigger> {
  late Offset _position;
  bool _initialized = false;
  bool _dragging = false;
  Offset? _dragStart;
  Offset? _posAtDragStart;

  @override
  void initState() {
    super.initState();
    if (widget.config.persistFabPosition) {
      _loadPersistedPosition();
    }
  }

  void _initDefaultPosition(Size screen) {
    if (_initialized) return;
    _initialized = true;
    final insets = widget.config.triggerInsets;
    final x = insets.left != null
        ? insets.left!
        : screen.width - _kFabSize - (insets.right ?? _kEdgePad);
    final y = screen.height - _kFabSize - insets.bottom;
    _position = Offset(x, y);
  }

  Future<void> _loadPersistedPosition() async {
    try {
      // Lazy-load SharedPreferences to avoid breaking apps that don't have it.
      const channel = MethodChannel('plugins.flutter.io/shared_preferences');
      final raw = await channel.invokeMethod<Map<Object?, Object?>>('getAll');
      final encoded = raw?[_kPosKey] as String?;
      if (encoded != null) {
        final parts = encoded.split(',');
        if (parts.length == 2) {
          final x = double.tryParse(parts[0]);
          final y = double.tryParse(parts[1]);
          if (x != null && y != null && mounted) {
            setState(() {
              _position = Offset(x, y);
              _initialized = true;
            });
          }
        }
      }
    } catch (_) {
      // SharedPreferences unavailable — use default position
    }
  }

  Future<void> _persistPosition() async {
    try {
      const channel = MethodChannel('plugins.flutter.io/shared_preferences');
      await channel.invokeMethod<void>('setString', <String, dynamic>{
        'key': _kPosKey,
        'value': '${_position.dx},${_position.dy}',
      });
    } catch (_) {
      // Non-fatal
    }
  }

  Offset _clamp(Offset pos, Size screen) {
    final x = pos.dx.clamp(_kEdgePad, screen.width - _kFabSize - _kEdgePad);
    final y = pos.dy.clamp(_kEdgePad, screen.height - _kFabSize - _kEdgePad);
    return Offset(x, y);
  }

  Offset _snapToEdge(Offset pos, Size screen) {
    if (!widget.config.snapToEdge) return pos;
    final mid = screen.width / 2;
    final snappedX = pos.dx + _kFabSize / 2 < mid
        ? _kEdgePad
        : screen.width - _kFabSize - _kEdgePad;
    return Offset(snappedX, pos.dy);
  }

  @override
  Widget build(BuildContext context) {
    final screen = MediaQuery.sizeOf(context);
    final safeBottom = MediaQuery.paddingOf(context).bottom;
    final isDark = widget.config.theme.resolvedDark(context);
    final accent = widget.config.theme.accentColor;

    if (!_initialized) {
      _initDefaultPosition(
        Size(screen.width, screen.height - safeBottom),
      );
    }

    final fab = Semantics(
      button: true,
      label: 'Report a bug',
      child: GestureDetector(
        onTap: _dragging ? null : widget.onPressed,
        onLongPressStart: widget.config.draggable
            ? (details) {
                setState(() {
                  _dragging = true;
                  _dragStart = details.globalPosition;
                  _posAtDragStart = _position;
                });
              }
            : null,
        onLongPressMoveUpdate: widget.config.draggable
            ? (details) {
                if (_dragStart == null || _posAtDragStart == null) return;
                final delta = details.globalPosition - _dragStart!;
                setState(() {
                  _position = _clamp(
                    _posAtDragStart! + delta,
                    Size(screen.width, screen.height - safeBottom),
                  );
                });
              }
            : null,
        onLongPressEnd: widget.config.draggable
            ? (_) {
                final snapped = _snapToEdge(
                  _position,
                  Size(screen.width, screen.height - safeBottom),
                );
                setState(() {
                  _dragging = false;
                  _dragStart = null;
                  _posAtDragStart = null;
                  _position = snapped;
                });
                if (widget.config.persistFabPosition) _persistPosition();
              }
            : null,
        child: AnimatedScale(
          scale: _dragging ? 1.08 : 1.0,
          duration: const Duration(milliseconds: 150),
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: isDark ? const Color(0xFF0F0E0C) : const Color(0xFFF8F4ED),
              border: Border.all(color: accent.withOpacity(0.35)),
              borderRadius: BorderRadius.circular(4),
              boxShadow: [
                BoxShadow(
                  color: _dragging
                      ? accent.withOpacity(0.35)
                      : const Color(0x33000000),
                  blurRadius: _dragging ? 20 : 14,
                  offset: const Offset(0, 6),
                ),
              ],
            ),
            child: SizedBox(
              width: _kFabSize,
              height: _kFabSize,
              child: Center(
                child: Text(
                  '🐛',
                  style: TextStyle(
                    fontSize: 24,
                    color: isDark
                        ? const Color(0xFFF2EBDD)
                        : const Color(0xFF0E0D0B),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );

    if (widget.config.draggable) {
      return Positioned(
        left: _position.dx,
        top: _position.dy,
        child: fab,
      );
    }

    // Non-draggable: use original edge anchoring
    final insets = widget.config.triggerInsets;
    return Positioned(
      right: insets.left == null ? insets.right : null,
      left: insets.left,
      bottom: insets.bottom + safeBottom,
      child: fab,
    );
  }
}
