import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';

/// 글자 하나하나가 블러 속에서 떠오르는 키네틱 타이포 리빌.
/// '\n'으로 줄을 나누고, 각 글자는 [charInterval] 간격의 스태거로 등장한다.
class KineticRevealText extends StatelessWidget {
  final String text;
  final TextStyle? style;
  final Duration delay;
  final Duration charInterval;
  final TextAlign textAlign;

  const KineticRevealText(
    this.text, {
    super.key,
    this.style,
    this.delay = Duration.zero,
    this.charInterval = const Duration(milliseconds: 34),
    this.textAlign = TextAlign.start,
  });

  @override
  Widget build(BuildContext context) {
    final lines = text.split('\n');
    final crossAlign = switch (textAlign) {
      TextAlign.center => CrossAxisAlignment.center,
      TextAlign.right || TextAlign.end => CrossAxisAlignment.end,
      _ => CrossAxisAlignment.start,
    };
    var index = 0;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: crossAlign,
      children: [
        for (final line in lines)
          Wrap(
            alignment: switch (textAlign) {
              TextAlign.center => WrapAlignment.center,
              TextAlign.right || TextAlign.end => WrapAlignment.end,
              _ => WrapAlignment.start,
            },
            children: [
              for (final ch in line.characters)
                Text(ch, style: style)
                    .animate(delay: delay + charInterval * index++)
                    .fadeIn(duration: 280.ms)
                    .blurXY(begin: 9, end: 0, duration: 320.ms)
                    .slideY(
                      begin: 0.45,
                      end: 0,
                      duration: 380.ms,
                      curve: Curves.easeOutCubic,
                    ),
            ],
          ),
      ],
    );
  }
}
