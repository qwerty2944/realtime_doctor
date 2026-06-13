import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/utils/date_format.dart';
import '../../../domain/entities/session.dart';
import '../../../generated/l10n/app_localizations.dart';

class SessionCard extends StatelessWidget {
  const SessionCard({required this.session, required this.onTap, super.key});
  final Session session;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final cs = context.colors;
    final accent = session.color != null ? _parseColor(session.color!) : null;
    return Card(
      margin: EdgeInsets.symmetric(horizontal: AppSpacing.lg.w, vertical: 6.h),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: EdgeInsets.all(AppSpacing.md.r),
          child: Row(
            children: [
              // 세션 아바타 — 세션 색(있으면) 또는 브랜드 그라데이션 틴트.
              Container(
                width: 42.r,
                height: 42.r,
                decoration: BoxDecoration(
                  borderRadius: AppRadius.mdAll,
                  gradient: accent == null
                      ? LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [cs.primaryContainer, cs.tertiaryContainer],
                        )
                      : LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [
                            accent.withValues(alpha: 0.30),
                            accent.withValues(alpha: 0.12),
                          ],
                        ),
                ),
                child: Icon(
                  LucideIcons.mic,
                  size: 20.r,
                  color: accent ?? cs.onPrimaryContainer,
                ),
              ),
              SizedBox(width: AppSpacing.md.w),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            session.title?.isNotEmpty == true
                                ? session.title!
                                : formatSessionStart(session.startedAt),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: context.cardTitle,
                          ),
                        ),
                        if (session.pinned)
                          Icon(LucideIcons.pin, size: 14.r, color: cs.primary),
                      ],
                    ),
                    SizedBox(height: 4.h),
                    Text(
                      // 사용하는 STT provider 는 노출하지 않는다(내부 정보).
                      AppLocalizations.of(context)
                          .utteranceCount(session.chunkCount),
                      style: context.caption.copyWith(color: cs.outline),
                    ),
                    if (session.preview?.isNotEmpty == true) ...[
                      SizedBox(height: 4.h),
                      Text(
                        session.preview!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: context.cardBody.copyWith(
                          color: cs.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              Icon(LucideIcons.chevronRight, size: 18.r, color: cs.outline),
            ],
          ),
        ),
      ),
    );
  }

  Color? _parseColor(String hex) {
    var s = hex.replaceAll('#', '');
    if (s.length == 6) s = 'ff$s';
    final v = int.tryParse(s, radix: 16);
    return v == null ? null : Color(v);
  }
}
