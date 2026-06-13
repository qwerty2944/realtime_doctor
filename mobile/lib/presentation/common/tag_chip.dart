import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

import '../../app/theme.dart';

/// 작은 pill 형 라벨 칩. 화자/신뢰도/번호 등 인라인 태그에 공통 사용.
class TagChip extends StatelessWidget {
  const TagChip({required this.label, this.color, this.icon, super.key});

  final String label;

  /// 강조색. 미지정 시 secondary 톤.
  final Color? color;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final c = color ?? context.colors.secondary;
    return Container(
      padding: EdgeInsets.symmetric(horizontal: AppSpacing.sm.w, vertical: 3.h),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.14),
        borderRadius: AppRadius.pillAll,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 11.sp, color: c),
            SizedBox(width: 3.w),
          ],
          Text(
            label,
            style: TextStyle(
              fontSize: 10.5.sp,
              fontWeight: FontWeight.w700,
              color: c,
              letterSpacing: 0.2,
            ),
          ),
        ],
      ),
    );
  }
}
