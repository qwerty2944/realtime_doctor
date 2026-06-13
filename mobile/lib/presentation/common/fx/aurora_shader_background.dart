import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_animate/flutter_animate.dart';

import '../../../app/theme.dart';

/// 프래그먼트 셰이더로 그리는 살아있는 오로라 배경 — 도메인 워핑 FBM 잉크가
/// 테마 색(primary/tertiary/secondary)으로 흐른다(Wonderous 풍).
/// 셰이더 로드 전/실패 시엔 [_BlobFallback] 그라데이션 블롭으로 폴백.
/// [intensity]로 농도 조절(0~1).
class AuroraShaderBackground extends StatefulWidget {
  final double intensity;
  const AuroraShaderBackground({super.key, this.intensity = 1});

  @override
  State<AuroraShaderBackground> createState() => _AuroraShaderBackgroundState();
}

class _AuroraShaderBackgroundState extends State<AuroraShaderBackground>
    with SingleTickerProviderStateMixin {
  // 프로그램은 앱 수명 동안 1회만 컴파일.
  static Future<ui.FragmentProgram>? _programFuture;
  static ui.FragmentProgram? _program;

  ui.FragmentShader? _shader;
  bool _failed = false;
  late final Ticker _ticker;
  final ValueNotifier<double> _time = ValueNotifier(0);

  @override
  void initState() {
    super.initState();
    _ticker = createTicker((elapsed) {
      _time.value = elapsed.inMicroseconds / 1e6;
    });
    if (_program != null) {
      _shader = _program!.fragmentShader();
      _ticker.start();
    } else {
      _programFuture ??= ui.FragmentProgram.fromAsset(
        'assets/shaders/aurora.frag',
      );
      _programFuture!
          .then((p) {
            _program = p;
            if (!mounted) return;
            setState(() => _shader = p.fragmentShader());
            _ticker.start();
          })
          .catchError((_) {
            if (mounted) setState(() => _failed = true);
          });
    }
  }

  @override
  void dispose() {
    _ticker.dispose();
    _time.dispose();
    _shader?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final shader = _shader;
    if (shader == null || _failed) {
      return _BlobFallback(intensity: widget.intensity);
    }
    // 접근성: 모션 최소화 설정이면 정지 화면으로.
    final animate = !MediaQuery.disableAnimationsOf(context);
    if (_ticker.isActive && !animate) _ticker.stop();
    if (!_ticker.isActive && animate) _ticker.start();

    final cs = context.colors;
    return Positioned.fill(
      child: IgnorePointer(
        child: RepaintBoundary(
          child: CustomPaint(
            painter: _AuroraShaderPainter(
              shader: shader,
              time: _time,
              intensity: widget.intensity,
              dark: cs.brightness == Brightness.dark,
              colorA: cs.primary,
              colorB: cs.tertiary,
              colorC: cs.secondary,
              bg: cs.surface,
            ),
          ),
        ),
      ),
    );
  }
}

class _AuroraShaderPainter extends CustomPainter {
  final ui.FragmentShader shader;
  final ValueNotifier<double> time;
  final double intensity;
  final bool dark;
  final Color colorA;
  final Color colorB;
  final Color colorC;
  final Color bg;

  _AuroraShaderPainter({
    required this.shader,
    required this.time,
    required this.intensity,
    required this.dark,
    required this.colorA,
    required this.colorB,
    required this.colorC,
    required this.bg,
  }) : super(repaint: time);

  static void _setColor(ui.FragmentShader s, int index, Color c) {
    s.setFloat(index, c.r);
    s.setFloat(index + 1, c.g);
    s.setFloat(index + 2, c.b);
  }

  @override
  void paint(Canvas canvas, Size size) {
    shader.setFloat(0, size.width);
    shader.setFloat(1, size.height);
    shader.setFloat(2, time.value);
    shader.setFloat(3, intensity);
    shader.setFloat(4, dark ? 1 : 0);
    _setColor(shader, 5, colorA);
    _setColor(shader, 8, colorB);
    _setColor(shader, 11, colorC);
    _setColor(shader, 14, bg);
    canvas.drawRect(Offset.zero & size, Paint()..shader = shader);
  }

  @override
  bool shouldRepaint(_AuroraShaderPainter old) =>
      old.intensity != intensity ||
      old.dark != dark ||
      old.shader != shader ||
      old.colorA != colorA;
}

/// 셰이더 폴백 — 테마 색 블롭 두 개가 모서리에서 천천히 떠다니는 배경.
class _BlobFallback extends StatelessWidget {
  final double intensity;
  const _BlobFallback({required this.intensity});

  @override
  Widget build(BuildContext context) {
    final cs = context.colors;
    final isDark = cs.brightness == Brightness.dark;
    final alpha = (isDark ? 0.20 : 0.14) * intensity;
    Widget blob(Color color, double size) => Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: RadialGradient(
          colors: [
            color.withValues(alpha: alpha),
            color.withValues(alpha: 0),
          ],
        ),
      ),
    );
    return Positioned.fill(
      child: IgnorePointer(
        child: Stack(
          children: [
            Positioned(
              top: -80,
              left: -60,
              child: blob(cs.primary, 320)
                  .animate(onPlay: (c) => c.repeat(reverse: true))
                  .move(
                    begin: Offset.zero,
                    end: const Offset(40, 30),
                    duration: 6.seconds,
                    curve: Curves.easeInOut,
                  )
                  .scaleXY(begin: 1, end: 1.15, duration: 6.seconds),
            ),
            Positioned(
              bottom: 40,
              right: -90,
              child: blob(cs.tertiary, 360)
                  .animate(onPlay: (c) => c.repeat(reverse: true))
                  .move(
                    begin: Offset.zero,
                    end: const Offset(-35, -40),
                    duration: 7.seconds,
                    curve: Curves.easeInOut,
                  )
                  .scaleXY(begin: 1.1, end: 0.95, duration: 7.seconds),
            ),
          ],
        ),
      ),
    );
  }
}
