import 'package:flutter/material.dart';

/// 진입 시 살짝 떠오르며 페이드인하는 래퍼. 리스트에서 `index` 를 주면
/// 항목마다 지연이 누적돼 staggered(계단식) 등장 효과가 난다.
///
/// 한 번만 재생되는 implicit 애니메이션이라 컨트롤러 비용이 없다.
class FadeSlideIn extends StatelessWidget {
  const FadeSlideIn({
    required this.child,
    this.index = 0,
    this.offsetY = 12,
    super.key,
  });

  final Widget child;
  final int index;
  final double offsetY;

  @override
  Widget build(BuildContext context) {
    final delayMs = (index * 45).clamp(0, 360);
    final totalMs = 360 + delayMs;
    final start = delayMs / totalMs;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: Duration(milliseconds: totalMs),
      curve: Interval(start, 1, curve: Curves.easeOutCubic),
      builder: (context, t, child) => Opacity(
        opacity: t.clamp(0, 1),
        child: Transform.translate(
          offset: Offset(0, (1 - t) * offsetY),
          child: child,
        ),
      ),
      child: child,
    );
  }
}
