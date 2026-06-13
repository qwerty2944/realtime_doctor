import 'package:flutter/material.dart';

import '../../../app/theme.dart';
import 'aurora_shader_background.dart';

/// 화면 전체를 오로라 셰이더 위에 올리는 래퍼. [child]엔 보통
/// `Scaffold(backgroundColor: Colors.transparent, appBar: GlassAppBar(...))`를
/// 넣는다 — 글래스 앱바/탭바 뒤로 오로라가 비쳐 보인다.
class AuroraScene extends StatelessWidget {
  final Widget child;

  /// 본체 화면은 가독성을 위해 은은하게(기본 0.35), 인증 화면은 진하게.
  final double intensity;

  const AuroraScene({super.key, required this.child, this.intensity = 0.35});

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Positioned.fill(child: ColoredBox(color: context.colors.surface)),
        AuroraShaderBackground(intensity: intensity),
        child,
      ],
    );
  }
}
