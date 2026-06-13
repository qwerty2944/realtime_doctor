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

/// 의학 용어 카드 리스트.
class TermsView extends StatelessWidget {
  const TermsView({required this.analysis, super.key});
  final Analysis? analysis;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final cs = context.colors;
    final terms = analysis?.medicalTerms ?? const <MedicalTerm>[];
    if (terms.isEmpty) {
      return EmptyView(message: t.termsEmpty, icon: LucideIcons.bookOpen);
    }
    return ListView.builder(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.md.r,
        AppSpacing.md.r,
        AppSpacing.md.r,
        AppSpacing.md.r + context.glassNavBarInset,
      ),
      itemCount: terms.length,
      itemBuilder: (_, i) {
        final term = terms[i];
        return Padding(
          padding: EdgeInsets.only(bottom: AppSpacing.sm.h),
          child: FadeSlideIn(
            index: i,
            child: ContentCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    term.term +
                        (term.termEn != null && term.termEn != term.term
                            ? ' (${term.termEn})'
                            : ''),
                    style: context.cardTitle,
                  ),
                  SizedBox(height: AppSpacing.sm.h),
                  SectionHeader(t.termDefinition),
                  SizedBox(height: 2.h),
                  Text(term.definition, style: context.cardBody),
                  if (term.contextQuote != null &&
                      term.contextQuote!.isNotEmpty) ...[
                    SizedBox(height: AppSpacing.sm.h),
                    SectionHeader(t.termContext),
                    SizedBox(height: 2.h),
                    Container(
                      width: double.infinity,
                      padding: EdgeInsets.all(AppSpacing.sm.r),
                      decoration: BoxDecoration(
                        color: cs.surfaceContainerHighest.withValues(
                          alpha: 0.6,
                        ),
                        borderRadius: AppRadius.smAll,
                        border: Border(
                          left: BorderSide(
                            color: cs.primary.withValues(alpha: 0.4),
                            width: 2,
                          ),
                        ),
                      ),
                      child: Text(
                        '"${term.contextQuote!}"',
                        style: context.quote,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
