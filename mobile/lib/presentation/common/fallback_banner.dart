import 'package:flutter/material.dart';

import '../../generated/l10n/app_localizations.dart';
import 'action_banner.dart';

/// 전사가 스트림→청크로 자동 fallback 됐을 때의 dismissible 경고 배너.
///
/// 데스크톱 앱의 `transcribe:fallback` IPC 와 짝. 공통 [ActionBanner] 의 warning 변형.
class FallbackBanner extends StatelessWidget {
  const FallbackBanner({
    required this.message,
    required this.onDismiss,
    super.key,
  });

  final String message;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    AppLocalizations.of(context); // 로케일 의존성 유지(메시지는 상위에서 i18n).
    return ActionBanner(
      message: message,
      severity: BannerSeverity.warning,
      onDismiss: onDismiss,
    );
  }
}
