import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';

import '../../../core/utils/date_format.dart';
import '../../../domain/entities/speaker.dart';
import '../../../domain/entities/transcript_chunk.dart';
import '../../../generated/l10n/app_localizations.dart';

class TranscriptView extends StatelessWidget {
  const TranscriptView({required this.chunks, super.key});
  final List<TranscriptChunk> chunks;

  ({Color bg, Color chip, String label}) _styleFor(
    Speaker s,
    AppLocalizations t,
    ColorScheme cs,
  ) {
    return switch (s) {
      Speaker.doctor => (
          bg: cs.primaryContainer.withValues(alpha: 0.3),
          chip: cs.primary,
          label: t.speakerDoctor,
        ),
      Speaker.patient => (
          bg: cs.tertiaryContainer.withValues(alpha: 0.3),
          chip: cs.tertiary,
          label: t.speakerPatient,
        ),
      Speaker.unknown => (
          bg: cs.surfaceContainerHighest,
          chip: cs.outline,
          label: t.speakerUnknown,
        ),
    };
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final cs = Theme.of(context).colorScheme;
    if (chunks.isEmpty) {
      return Center(child: Text(t.noData));
    }
    return ListView.builder(
      padding: EdgeInsets.all(12.r),
      itemCount: chunks.length,
      itemBuilder: (_, i) {
        final c = chunks[i];
        final s = _styleFor(c.speaker, t, cs);
        return Container(
          margin: EdgeInsets.only(bottom: 8.h),
          padding: EdgeInsets.all(10.r),
          decoration: BoxDecoration(
            color: s.bg,
            borderRadius: BorderRadius.circular(10.r),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: EdgeInsets.symmetric(horizontal: 6.w, vertical: 2.h),
                    decoration: BoxDecoration(
                      color: s.chip.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(4.r),
                    ),
                    child: Text(
                      s.label,
                      style: TextStyle(
                        fontSize: 10.sp,
                        fontWeight: FontWeight.w600,
                        color: s.chip,
                      ),
                    ),
                  ),
                  SizedBox(width: 6.w),
                  Text(
                    formatTimeOnly(c.timestamp),
                    style: TextStyle(
                      fontSize: 10.sp,
                      color: cs.outline,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                ],
              ),
              SizedBox(height: 4.h),
              Text(c.text, style: TextStyle(fontSize: 13.sp, height: 1.4)),
            ],
          ),
        );
      },
    );
  }
}
