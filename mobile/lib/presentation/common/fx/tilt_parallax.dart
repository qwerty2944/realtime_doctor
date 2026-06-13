import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';

/// 포인터를 따라 살짝 기울어지는 3D 패럴랙스 래퍼(gskinner Vignettes 풍).
/// 터치를 떼면 스프링처럼 원위치로 돌아온다. 이벤트를 소비하지 않으므로
/// 내부의 버튼·입력 필드는 그대로 동작한다.
class TiltParallax extends StatefulWidget {
  final Widget child;

  /// 최대 기울기(라디안). 텍스트 입력을 방해하지 않게 기본값은 미묘하게.
  final double maxTilt;

  const TiltParallax({super.key, required this.child, this.maxTilt = 0.05});

  @override
  State<TiltParallax> createState() => _TiltParallaxState();
}

class _TiltParallaxState extends State<TiltParallax>
    with SingleTickerProviderStateMixin {
  late final Ticker _ticker;
  Offset _target = Offset.zero; // 정규화 좌표 (-1..1)
  Offset _current = Offset.zero;

  @override
  void initState() {
    super.initState();
    _ticker = createTicker(_tick)..start();
  }

  void _tick(Duration _) {
    // 임계 감쇠 추적 — 목표를 천천히 따라가고, 떼면 부드럽게 복귀.
    final next = Offset.lerp(_current, _target, 0.12)!;
    if ((next - _current).distanceSquared < 1e-7 &&
        _target == Offset.zero &&
        _current == Offset.zero) {
      return; // 정지 상태에선 setState 생략.
    }
    setState(() => _current = next);
  }

  @override
  void dispose() {
    _ticker.dispose();
    super.dispose();
  }

  void _update(Offset local, Size size) {
    final dx = (local.dx / size.width) * 2 - 1;
    final dy = (local.dy / size.height) * 2 - 1;
    _target = Offset(dx.clamp(-1, 1), dy.clamp(-1, 1));
  }

  @override
  Widget build(BuildContext context) {
    if (MediaQuery.disableAnimationsOf(context)) return widget.child;
    return LayoutBuilder(
      builder: (context, constraints) {
        final size = constraints.biggest;
        return Listener(
          behavior: HitTestBehavior.translucent,
          onPointerDown: (e) => _update(e.localPosition, size),
          onPointerMove: (e) => _update(e.localPosition, size),
          onPointerUp: (_) => _target = Offset.zero,
          onPointerCancel: (_) => _target = Offset.zero,
          child: Transform(
            alignment: Alignment.center,
            transform: Matrix4.identity()
              ..setEntry(3, 2, 0.0012) // 원근
              ..rotateX(-_current.dy * widget.maxTilt)
              ..rotateY(_current.dx * widget.maxTilt),
            child: widget.child,
          ),
        );
      },
    );
  }
}
