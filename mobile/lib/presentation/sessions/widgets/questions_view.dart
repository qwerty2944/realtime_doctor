import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/utils/layout.dart';
import '../../../domain/entities/analysis.dart';
import '../../../generated/l10n/app_localizations.dart';
import '../../common/content_card.dart';
import '../../common/empty_view.dart';
import '../../common/fade_slide_in.dart';
import '../../common/section_header.dart';

/// 감별 좁히기용 추천 follow-up 질문 카드.
class QuestionsView extends StatelessWidget {
  const QuestionsView({required this.analysis, super.key});
  final Analysis? analysis;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final cs = context.colors;
    final qs = analysis?.suggestedQuestions ?? const <SuggestedQuestion>[];
    if (qs.isEmpty) {
      return EmptyView(message: t.questionsEmpty, icon: LucideIcons.helpCircle);
    }
    return ListView.builder(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.md.r,
        AppSpacing.md.r,
        AppSpacing.md.r,
        AppSpacing.md.r + context.glassNavBarInset,
      ),
      itemCount: qs.length,
      itemBuilder: (_, i) {
        final q = qs[i];
        return Padding(
          padding: EdgeInsets.only(bottom: AppSpacing.sm.h),
          child: FadeSlideIn(
            index: i,
            child: ContentCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _IndexBadge(i + 1, color: cs.primary),
                      SizedBox(width: AppSpacing.sm.w),
                      Expanded(
                        child: Text(q.question, style: context.cardTitle),
                      ),
                    ],
                  ),
                  SizedBox(height: AppSpacing.sm.h),
                  SectionHeader(t.questionRationale),
                  SizedBox(height: 2.h),
                  Text(q.rationale, style: context.cardBody),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// 질문 번호 원형 뱃지.
class _IndexBadge extends StatelessWidget {
  const _IndexBadge(this.n, {required this.color});
  final int n;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 22.r,
      height: 22.r,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        shape: BoxShape.circle,
      ),
      child: Text(
        '$n',
        style: TextStyle(
          fontSize: 11.sp,
          fontWeight: FontWeight.w800,
          color: color,
        ),
      ),
    );
  }
}
