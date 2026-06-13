import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/utils/layout.dart';
import '../../../domain/entities/dictation.dart';
import '../../../generated/l10n/app_localizations.dart';
import '../../common/analyzing_indicator.dart';
import '../../common/app_dropdown.dart';
import '../../common/editable_text_section.dart';
import '../../common/empty_view.dart';
import '../../common/generate_button.dart';
import '../../common/section_header.dart';
import '../../settings/controllers/dictation_template_controller.dart';

/// EMR 받아쓰기 표시 + 템플릿 선택 + 인라인 편집 + 복사 + 재생성.
class DictationView extends ConsumerStatefulWidget {
  const DictationView({
    required this.dictation,
    this.busy = false,
    this.onChanged,
    this.onRegenerate,
    super.key,
  });

  final Dictation? dictation;
  final bool busy;
  final ValueChanged<Dictation>? onChanged;
  final VoidCallback? onRegenerate;

  @override
  ConsumerState<DictationView> createState() => _DictationViewState();
}

class _DictationViewState extends ConsumerState<DictationView>
    with AutomaticKeepAliveClientMixin<DictationView> {
  @override
  bool get wantKeepAlive => true;

  String _templateLabel(DictationTemplate t, AppLocalizations l) => switch (t) {
    DictationTemplate.soap => l.templateSoap,
    DictationTemplate.apso => l.templateApso,
    DictationTemplate.hp => l.templateHp,
    DictationTemplate.narrative => l.templateNarrative,
  };

  Future<void> _copyAll(Dictation d) async {
    final t = AppLocalizations.of(context);
    final text = d.sections.map((s) => '${s.heading}\n${s.body}').join('\n\n');
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
    final d = widget.dictation;
    final selectedTemplate = ref.watch(dictationTemplateControllerProvider);

    void updateSection(int index, String body) {
      if (d == null) return;
      final next = [
        for (var i = 0; i < d.sections.length; i++)
          if (i == index) d.sections[i].copyWith(body: body) else d.sections[i],
      ];
      widget.onChanged?.call(d.copyWith(sections: next));
    }

    // 헤더(템플릿 피커)는 상단에 고정, 본문만 스크롤/채움.
    return Column(
      children: [
        Padding(
          padding: EdgeInsets.fromLTRB(
            AppSpacing.md.r,
            AppSpacing.sm.h,
            AppSpacing.md.r,
            0,
          ),
          child: Column(
            children: [
              Row(
                children: [
                  SectionHeader(t.dictationTemplate),
                  const Spacer(),
                  if (d != null)
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      onPressed: () => _copyAll(d),
                      tooltip: t.copyAll,
                      icon: Icon(LucideIcons.copy, size: 18.r),
                    ),
                  SizedBox(width: AppSpacing.xs.w),
                  // 항상 보이는 "분석"(생성) 버튼 — 받아쓰기도 다른 탭과 동일.
                  GenerateButton(
                    busy: widget.busy,
                    onPressed: widget.onRegenerate,
                  ),
                ],
              ),
              SizedBox(height: AppSpacing.sm.h),
              // 풀폭 패키지 드롭다운 — 보더 버튼 + 둥근 팝업.
              AppDropdown<DictationTemplate>(
                value: selectedTemplate,
                isExpanded: true,
                items: DictationTemplate.values,
                labelOf: (tpl) => _templateLabel(tpl, t),
                onChanged: widget.busy
                    ? null
                    : (v) => ref
                          .read(dictationTemplateControllerProvider.notifier)
                          .setTemplate(v),
              ),
            ],
          ),
        ),
        Expanded(
          child: d == null
              // 빈 상태 — 생성 중이면 인디케이터, 아니면 가운데 빈 메시지.
              ? (widget.busy
                    ? const AnalyzingIndicator()
                    : Center(child: EmptyView(message: t.dictationEmpty)))
              : ListView(
                  padding: EdgeInsets.fromLTRB(
                    AppSpacing.md.r,
                    AppSpacing.md.h,
                    AppSpacing.md.r,
                    AppSpacing.md.r + context.glassNavBarInset,
                  ),
                  children: [
                    for (var i = 0; i < d.sections.length; i++)
                      EditableTextSection(
                        heading: d.sections[i].heading,
                        body: d.sections[i].body,
                        onSave: (v) => updateSection(i, v),
                      ),
                  ],
                ),
        ),
      ],
    );
  }
}
