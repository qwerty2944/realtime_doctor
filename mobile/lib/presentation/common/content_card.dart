import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

import '../../app/theme.dart';

/// 콘텐츠 카드 컨테이너. diagnosis/terms/questions 등 카드형 항목의 패딩·테두리·
/// 라운드를 토큰으로 통일한다. (Card 테마가 색/테두리를 담당, 여기선 패딩만 통일)
class ContentCard extends StatelessWidget {
  const ContentCard({
    required this.child,
    this.padding,
    this.onTap,
    this.accent,
    super.key,
  });

  final Widget child;
  final EdgeInsetsGeometry? padding;
  final VoidCallback? onTap;

  /// 좌측 강조 바 색(선택). 지정 시 카드 왼쪽에 4px 컬러 인디케이터.
  final Color? accent;

  @override
  Widget build(BuildContext context) {
    Widget content = Padding(
      padding: padding ?? EdgeInsets.all(AppSpacing.md.r),
      child: child,
    );

    if (accent != null) {
      content = Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            width: 4.w,
            decoration: BoxDecoration(
              color: accent,
              borderRadius: BorderRadius.horizontal(
                left: Radius.circular(AppRadius.md.r),
              ),
            ),
          ),
          Expanded(child: content),
        ],
      );
    }

    return Card(
      clipBehavior: Clip.antiAlias,
      child: onTap == null ? content : InkWell(onTap: onTap, child: content),
    );
  }
}
