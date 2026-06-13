import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:flutter_spinkit/flutter_spinkit.dart';

import '../../app/theme.dart';
import '../../generated/l10n/app_localizations.dart';

/// 분석/생성 진행 중 가운데에 표시하는 인디케이터 — "분석 중" + 통통 튀는 점
/// 세 개(flutter_spinkit). 빈 화면 로딩 상태에 쓴다.
class AnalyzingIndicator extends StatelessWidget {
  const AnalyzingIndicator({super.key});

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final cs = context.colors;
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            t.analyzing,
            style: context.cardBody.copyWith(
              color: cs.onSurfaceVariant,
              fontWeight: FontWeight.w700,
            ),
          ),
          SizedBox(height: AppSpacing.md.h),
          SpinKitThreeBounce(color: cs.primary, size: 22.r),
        ],
      ),
    );
  }
}
