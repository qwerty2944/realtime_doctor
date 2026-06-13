import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/utils/layout.dart';
import '../../../domain/entities/summary.dart';
import '../../../generated/l10n/app_localizations.dart';
import '../../common/analyzing_indicator.dart';
import '../../common/editable_text_section.dart';
import '../../common/generate_button.dart';

/// 진료 요약(chart-note) 표시 + 인라인 편집 + 복사 + 재생성.
///
/// 데이터 소스(현재 Summary, busy, onChanged, onRegenerate)는 부모가 제공.
/// 탭 전환 시 편집 상태 보존을 위해 `AutomaticKeepAliveClientMixin` 사용.
class SummaryView extends ConsumerStatefulWidget {
  const SummaryView({
    required this.summary,
    this.busy = false,
    this.onChanged,
    this.onRegenerate,
    super.key,
  });

  final Summary? summary;
  final bool busy;
  final ValueChanged<Summary>? onChanged;
  final VoidCallback? onRegenerate;

  @override
  ConsumerState<SummaryView> createState() => _SummaryViewState();
}

class _SummaryViewState extends ConsumerState<SummaryView>
    with AutomaticKeepAliveClientMixin<SummaryView> {
  @override
  bool get wantKeepAlive => true;

  Future<void> _copyAll(Summary s, AppLocalizations t) async {
    final text = [
      '${t.summarySectionChief}\n${s.chiefComplaint}',
      '${t.summarySectionHpi}\n${s.historyOfPresentIllness}',
      '${t.summarySectionFindings}\n${s.pertinentFindings}',
      '${t.summarySectionInvestigations}\n${s.investigationsMentioned}',
      '${t.summarySectionImpression}\n${s.clinicalImpression}',
      '${t.summarySectionPlan}\n${s.plan}',
    ].join('\n\n');
    await Clipboard.setData(ClipboardData(text: text));
    if (!mounted) return;
    ScaffoldMessenger.of(context).hideCurrentSnackBar();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(t.copied),
        duration: const Duration(milliseconds: 1200),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final t = AppLocalizations.of(context);
    final s = widget.summary;

    // 요약이 없어도 상단에 "분석"(생성) 버튼 + 섹션 틀(빈칸)을 노출.
    if (s == null) {
      final headings = [
        t.summarySectionChief,
        t.summarySectionHpi,
        t.summarySectionFindings,
        t.summarySectionInvestigations,
        t.summarySectionImpression,
        t.summarySectionPlan,
      ];
      return Column(
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(
              AppSpacing.md.w,
              AppSpacing.sm.h,
              AppSpacing.md.w,
              0,
            ),
            child: Align(
              alignment: Alignment.centerRight,
              child: GenerateButton(
                busy: widget.busy,
                onPressed: widget.onRegenerate,
              ),
            ),
          ),
          Expanded(
            child: widget.busy
                ? const AnalyzingIndicator()
                // 생성 전에도 빈칸 틀을 보여줘 구조를 가늠하게 한다.
                : ListView(
                    padding: EdgeInsets.fromLTRB(
                      AppSpacing.md.r,
                      AppSpacing.sm.h,
                      AppSpacing.md.r,
                      AppSpacing.md.r + context.glassNavBarInset,
                    ),
                    children: [
                      for (final h in headings) _EmptySection(heading: h),
                    ],
                  ),
          ),
        ],
      );
    }

    void update(Summary next) => widget.onChanged?.call(next);

    return ListView(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.md.r,
        AppSpacing.sm.h,
        AppSpacing.md.r,
        AppSpacing.md.r + context.glassNavBarInset,
      ),
      children: [
        _ActionRow(
          busy: widget.busy,
          onRegenerate: widget.onRegenerate,
          onCopyAll: () => _copyAll(s, t),
        ),
        SizedBox(height: 4.h),
        EditableTextSection(
          heading: t.summarySectionChief,
          body: s.chiefComplaint,
          onSave: (v) => update(s.copyWith(chiefComplaint: v)),
        ),
        EditableTextSection(
          heading: t.summarySectionHpi,
          body: s.historyOfPresentIllness,
          onSave: (v) => update(s.copyWith(historyOfPresentIllness: v)),
        ),
        EditableTextSection(
          heading: t.summarySectionFindings,
          body: s.pertinentFindings,
          onSave: (v) => update(s.copyWith(pertinentFindings: v)),
        ),
        EditableTextSection(
          heading: t.summarySectionInvestigations,
          body: s.investigationsMentioned,
          onSave: (v) => update(s.copyWith(investigationsMentioned: v)),
        ),
        EditableTextSection(
          heading: t.summarySectionImpression,
          body: s.clinicalImpression,
          onSave: (v) => update(s.copyWith(clinicalImpression: v)),
        ),
        EditableTextSection(
          heading: t.summarySectionPlan,
          body: s.plan,
          onSave: (v) => update(s.copyWith(plan: v)),
        ),
      ],
    );
  }
}

/// 생성 전 빈 섹션 틀 — heading + 구분선 + 회색 플레이스홀더("—").
class _EmptySection extends StatelessWidget {
  const _EmptySection({required this.heading});
  final String heading;

  @override
  Widget build(BuildContext context) {
    final cs = context.colors;
    return Padding(
      padding: EdgeInsets.only(bottom: 14.h),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(heading, style: context.sectionLabel),
          SizedBox(height: 4.h),
          const Divider(height: 1),
          SizedBox(height: 6.h),
          Text('—', style: context.cardBody.copyWith(color: cs.outline)),
        ],
      ),
    );
  }
}

class _ActionRow extends StatelessWidget {
  const _ActionRow({
    required this.busy,
    required this.onCopyAll,
    this.onRegenerate,
  });

  final bool busy;
  final VoidCallback? onRegenerate;
  final VoidCallback onCopyAll;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return Row(
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        TextButton.icon(
          onPressed: onCopyAll,
          icon: Icon(LucideIcons.copy, size: 16.r),
          label: Text(t.copyAll),
        ),
        SizedBox(width: AppSpacing.sm.w),
        GenerateButton(busy: busy, onPressed: onRegenerate),
      ],
    );
  }
}
