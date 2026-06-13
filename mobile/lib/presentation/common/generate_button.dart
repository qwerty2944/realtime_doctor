import 'package:flutter/material.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../generated/l10n/app_localizations.dart';

/// 분석/요약/받아쓰기 탭 공용 "분석"(생성) 버튼 — 항상 보이고, 진행 중이면
/// 스피너, 불가하면 비활성. 모든 탭에서 동일한 모양으로 통일.
class GenerateButton extends StatelessWidget {
  const GenerateButton({required this.busy, required this.onPressed, super.key});

  /// null 이면 비활성(예: 발화가 없을 때).
  final VoidCallback? onPressed;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    return FilledButton.tonalIcon(
      onPressed: busy ? null : onPressed,
      icon: busy
          ? SizedBox(
              width: 16.r,
              height: 16.r,
              child: const CircularProgressIndicator(strokeWidth: 2),
            )
          : Icon(LucideIcons.sparkles, size: 16.r),
      label: Text(t.captureAnalyze),
    );
  }
}
