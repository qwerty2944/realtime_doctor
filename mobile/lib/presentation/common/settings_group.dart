import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

import '../../app/theme.dart';
import 'section_header.dart';

/// 설정 화면의 카드형 그룹 — 섹션 라벨 + 항목들을 하나의 카드로 묶는다
/// (iOS 그룹 리스트 풍). [label]이 없으면 카드만 그린다.
class SettingsGroup extends StatelessWidget {
  const SettingsGroup({required this.children, this.label, super.key});

  final String? label;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.lg.w,
        AppSpacing.lg.h,
        AppSpacing.lg.w,
        0,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (label != null) ...[
            Padding(
              padding: EdgeInsets.only(left: AppSpacing.sm.w),
              child: SectionHeader(label!),
            ),
            SizedBox(height: AppSpacing.sm.h),
          ],
          Card(
            clipBehavior: Clip.antiAlias,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: children,
            ),
          ),
        ],
      ),
    );
  }
}
