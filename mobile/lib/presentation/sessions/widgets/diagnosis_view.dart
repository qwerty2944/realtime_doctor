import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/utils/layout.dart';
import '../../../domain/entities/analysis.dart';
import '../../../generated/l10n/app_localizations.dart';
import '../../common/empty_view.dart';
import '../../common/fade_slide_in.dart';
import '../../common/tag_chip.dart';

/// 감별진단 + Red flag 만 표시.
///
/// 일렉트론 desktop 의 Diagnosis 윈도우와 동일한 책임. Terms·Questions 는 별도 탭.
/// 진단 카드를 탭하면 선택 강조(검토할 진단 표시용, UI 한정 상태).
class DiagnosisView extends StatefulWidget {
  const DiagnosisView({required this.analysis, super.key});
  final Analysis? analysis;

  @override
  State<DiagnosisView> createState() => _DiagnosisViewState();
}

class _DiagnosisViewState extends State<DiagnosisView> {
  int? _selected;

  String _confidenceLabel(double c, AppLocalizations t) {
    if (c >= 0.7) return t.confidenceHigh;
    if (c >= 0.4) return t.confidenceMedium;
    return t.confidenceLow;
  }

  Color _confidenceColor(double c, ColorScheme cs, AppTokens tk) {
    if (c >= 0.7) return tk.speakerPatient; // teal — 높은 신뢰도
    if (c >= 0.4) return cs.primary;
    return cs.outline;
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final cs = context.colors;
    final tk = context.tokens;
    final a = widget.analysis;
    if (a == null || (a.differentialDiagnoses.isEmpty && a.redFlags.isEmpty)) {
      return EmptyView(
        message: t.diagnosisEmpty,
        icon: LucideIcons.stethoscope,
      );
    }

    var animIndex = 0;
    return ListView(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.md.r,
        AppSpacing.md.r,
        AppSpacing.md.r,
        AppSpacing.md.r + context.glassNavBarInset,
      ),
      children: [
        if (a.redFlags.isNotEmpty) ...[
          FadeSlideIn(
            index: animIndex++,
            child: Card(
              color: cs.errorContainer.withValues(alpha: 0.5),
              shape: RoundedRectangleBorder(
                borderRadius: AppRadius.mdAll,
                side: BorderSide(color: cs.error.withValues(alpha: 0.3)),
              ),
              child: Padding(
                padding: EdgeInsets.all(AppSpacing.md.r),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          LucideIcons.alertTriangle,
                          size: 16.sp,
                          color: cs.error,
                        ),
                        SizedBox(width: AppSpacing.xs.w),
                        Text(
                          t.redFlag,
                          style: TextStyle(
                            fontWeight: FontWeight.w800,
                            color: cs.error,
                          ),
                        ),
                      ],
                    ),
                    SizedBox(height: AppSpacing.sm.h),
                    ...a.redFlags.map(
                      (f) => Padding(
                        padding: EdgeInsets.symmetric(vertical: 2.h),
                        child: Text('• $f', style: context.cardBody),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          SizedBox(height: AppSpacing.md.h),
        ],
        ...a.differentialDiagnoses.asMap().entries.map((e) {
          final i = e.key;
          final d = e.value;
          final selected = _selected == i;
          return Padding(
            padding: EdgeInsets.only(bottom: AppSpacing.sm.h),
            child: FadeSlideIn(
              index: animIndex++,
              child: GestureDetector(
                onTap: () => setState(() => _selected = selected ? null : i),
                // 선택 시 brand 틴트 + 보더 강조, 미선택은 기본 카드.
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  curve: Curves.easeOut,
                  decoration: BoxDecoration(
                    color: selected
                        ? cs.primaryContainer.withValues(alpha: 0.45)
                        : cs.surfaceContainerLowest,
                    borderRadius: AppRadius.mdAll,
                    border: Border.all(
                      color: selected
                          ? cs.primary
                          : cs.outlineVariant.withValues(alpha: 0.6),
                      width: selected ? 1.6 : 1,
                    ),
                  ),
                  padding: EdgeInsets.all(AppSpacing.md.r),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (selected)
                            Padding(
                              padding: EdgeInsets.only(right: AppSpacing.xs.w),
                              child: Icon(
                                LucideIcons.checkCircle2,
                                size: 18.r,
                                color: cs.primary,
                              ),
                            ),
                          Expanded(
                            child: Text(
                              '${i + 1}. ${d.name}'
                              '${d.nameEn != null && d.nameEn != d.name ? ' (${d.nameEn})' : ''}',
                              style: context.cardTitle,
                            ),
                          ),
                          SizedBox(width: AppSpacing.sm.w),
                          TagChip(
                            label:
                                '${_confidenceLabel(d.confidence, t)} · ${(d.confidence * 100).round()}%',
                            color: _confidenceColor(d.confidence, cs, tk),
                          ),
                        ],
                      ),
                      if (d.icd10 != null && d.icd10!.isNotEmpty)
                        Padding(
                          padding: EdgeInsets.only(top: 2.h),
                          child: Text(
                            '${t.diagnosisIcd10} · ${d.icd10}',
                            style: context.caption,
                          ),
                        ),
                      SizedBox(height: AppSpacing.sm.h),
                      Text(d.reasoning, style: context.cardBody),
                    ],
                  ),
                ),
              ),
            ),
          );
        }),
      ],
    );
  }
}
