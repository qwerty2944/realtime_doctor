import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

import '../../../domain/entities/dictation.dart';
import '../../../generated/l10n/app_localizations.dart';
import '../../common/empty_view.dart';

class DictationView extends StatelessWidget {
  const DictationView({required this.dictation, super.key});
  final Dictation? dictation;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    if (dictation == null) return EmptyView(message: t.dictationEmpty);
    final d = dictation!;
    return ListView.builder(
      padding: EdgeInsets.all(12.r),
      itemCount: d.sections.length,
      itemBuilder: (_, i) {
        final s = d.sections[i];
        return Padding(
          padding: EdgeInsets.only(bottom: 16.h),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                s.heading,
                style: TextStyle(
                  fontSize: 11.sp,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.5,
                  color: Theme.of(context).colorScheme.outline,
                ),
              ),
              SizedBox(height: 4.h),
              const Divider(height: 1),
              SizedBox(height: 6.h),
              Text(s.body, style: TextStyle(fontSize: 13.sp, height: 1.5)),
            ],
          ),
        );
      },
    );
  }
}
