import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

import '../../../domain/entities/analysis.dart';
import '../../../generated/l10n/app_localizations.dart';
import '../../common/empty_view.dart';

class AnalysisView extends StatelessWidget {
  const AnalysisView({required this.analysis, super.key});
  final Analysis? analysis;

  String _confidenceLabel(double c, AppLocalizations t) {
    if (c >= 0.7) return t.confidenceHigh;
    if (c >= 0.4) return t.confidenceMedium;
    return t.confidenceLow;
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    if (analysis == null || analysis!.isEmpty) {
      return EmptyView(message: t.diagnosisEmpty);
    }
    final a = analysis!;

    return ListView(
      padding: EdgeInsets.all(12.r),
      children: [
        if (a.redFlags.isNotEmpty) ...[
          Card(
            color: Theme.of(context).colorScheme.errorContainer.withValues(alpha: 0.4),
            child: Padding(
              padding: EdgeInsets.all(12.r),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Red flag',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                  SizedBox(height: 6.h),
                  ...a.redFlags.map(
                    (f) => Padding(
                      padding: EdgeInsets.symmetric(vertical: 2.h),
                      child: Text('• $f', style: TextStyle(fontSize: 12.sp)),
                    ),
                  ),
                ],
              ),
            ),
          ),
          SizedBox(height: 12.h),
        ],
        ...a.differentialDiagnoses.asMap().entries.map((e) {
          final i = e.key;
          final d = e.value;
          return Card(
            margin: EdgeInsets.only(bottom: 8.h),
            child: Padding(
              padding: EdgeInsets.all(12.r),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          '${i + 1}. ${d.name}'
                          '${d.nameEn != null && d.nameEn != d.name ? ' (${d.nameEn})' : ''}',
                          style: TextStyle(
                            fontSize: 14.sp,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                      Chip(
                        label: Text(
                          '${_confidenceLabel(d.confidence, t)} · ${(d.confidence * 100).round()}%',
                          style: TextStyle(fontSize: 10.sp),
                        ),
                      ),
                    ],
                  ),
                  if (d.icd10 != null && d.icd10!.isNotEmpty)
                    Padding(
                      padding: EdgeInsets.only(top: 2.h),
                      child: Text(
                        'ICD-10 · ${d.icd10}',
                        style: TextStyle(
                          fontSize: 10.sp,
                          color: Theme.of(context).colorScheme.outline,
                        ),
                      ),
                    ),
                  SizedBox(height: 6.h),
                  Text(d.reasoning, style: TextStyle(fontSize: 12.sp, height: 1.4)),
                ],
              ),
            ),
          );
        }),
        if (a.medicalTerms.isNotEmpty) ...[
          SizedBox(height: 8.h),
          Padding(
            padding: EdgeInsets.symmetric(horizontal: 4.w),
            child: Text(
              t.tabAnalysis,
              style: TextStyle(fontSize: 12.sp, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ],
    );
  }
}
