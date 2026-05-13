import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

import '../../../domain/entities/summary.dart';
import '../../../generated/l10n/app_localizations.dart';
import '../../common/empty_view.dart';

class SummaryView extends StatelessWidget {
  const SummaryView({required this.summary, super.key});
  final Summary? summary;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    if (summary == null) return EmptyView(message: t.summaryEmpty);
    final s = summary!;
    final fields = <(String, String)>[
      ('Chief complaint', s.chiefComplaint),
      ('History of present illness', s.historyOfPresentIllness),
      ('Pertinent findings', s.pertinentFindings),
      ('Investigations', s.investigationsMentioned),
      ('Clinical impression', s.clinicalImpression),
      ('Plan', s.plan),
    ];
    return ListView(
      padding: EdgeInsets.all(12.r),
      children: [
        for (final (label, body) in fields) ...[
          Text(
            label,
            style: TextStyle(
              fontSize: 10.sp,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.5,
              color: Theme.of(context).colorScheme.outline,
            ),
          ),
          SizedBox(height: 4.h),
          const Divider(height: 1),
          SizedBox(height: 6.h),
          Text(body, style: TextStyle(fontSize: 13.sp, height: 1.4)),
          SizedBox(height: 12.h),
        ],
      ],
    );
  }
}
