import 'package:flutter/material.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/constants/app_constants.dart';
import '../../../generated/l10n/app_localizations.dart';

/// 앱 정보 — [SettingsGroup] 카드 안에 들어가는 콘텐츠.
class AboutSection extends StatelessWidget {
  const AboutSection({super.key});

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);

    return ListTile(
      leading: Icon(LucideIcons.info, color: context.colors.outline),
      title: Text(AppConstants.appName),
      subtitle: Text('${t.appVersion} ${AppConstants.appVersion}'),
    );
  }
}
