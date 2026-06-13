import 'package:flutter/material.dart';

import '../../app/theme.dart';

/// 작은 대문자형 섹션 라벨. 설정 그룹·뷰 내부 라벨에서 공통 사용.
class SectionHeader extends StatelessWidget {
  const SectionHeader(this.label, {this.trailing, super.key});

  final String label;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final text = Text(label.toUpperCase(), style: context.sectionLabel);
    if (trailing == null) return text;
    return Row(
      children: [
        Expanded(child: text),
        trailing!,
      ],
    );
  }
}
