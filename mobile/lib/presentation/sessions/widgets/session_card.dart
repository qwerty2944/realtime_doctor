import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../core/utils/date_format.dart';
import '../../../domain/entities/session.dart';

class SessionCard extends StatelessWidget {
  const SessionCard({required this.session, required this.onTap, super.key});
  final Session session;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = session.color != null ? _parseColor(session.color!) : null;
    return Card(
      elevation: 0,
      margin: EdgeInsets.symmetric(horizontal: 16.w, vertical: 6.h),
      shape: RoundedRectangleBorder(
        side: BorderSide(color: theme.colorScheme.outlineVariant),
        borderRadius: BorderRadius.circular(12.r),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12.r),
        onTap: onTap,
        child: Padding(
          padding: EdgeInsets.all(14.r),
          child: Row(
            children: [
              if (color != null)
                Container(
                  width: 4.w,
                  height: 36.h,
                  decoration: BoxDecoration(
                    color: color,
                    borderRadius: BorderRadius.circular(2.r),
                  ),
                ),
              if (color != null) SizedBox(width: 12.w),
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
                            style: theme.textTheme.titleSmall,
                          ),
                        ),
                        if (session.pinned)
                          Icon(LucideIcons.pin,
                              size: 14.r,
                              color: theme.colorScheme.primary),
                      ],
                    ),
                    SizedBox(height: 4.h),
                    Text(
                      '${session.chunkCount} ${_unit(session.chunkCount)} · '
                      '${session.transcribeProvider ?? '—'}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.outline,
                      ),
                    ),
                    if (session.preview?.isNotEmpty == true) ...[
                      SizedBox(height: 4.h),
                      Text(
                        session.preview!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall,
                      ),
                    ],
                  ],
                ),
              ),
              Icon(LucideIcons.chevronRight,
                  size: 18.r, color: theme.colorScheme.outline),
            ],
          ),
        ),
      ),
    );
  }

  String _unit(int n) => n == 1 ? 'utterance' : 'utterances';

  Color? _parseColor(String hex) {
    var s = hex.replaceAll('#', '');
    if (s.length == 6) s = 'ff$s';
    final v = int.tryParse(s, radix: 16);
    return v == null ? null : Color(v);
  }
}
