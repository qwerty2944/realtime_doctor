import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../generated/l10n/app_localizations.dart';
import '../../../infrastructure/supabase/supabase_client_provider.dart';

/// 현재 로그인 계정 표시 — [SettingsGroup] 카드 안에 들어가는 콘텐츠.
class AccountSection extends ConsumerWidget {
  const AccountSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final cs = context.colors;
    final session = ref.watch(currentSessionProvider);
    final email = session?.user.email ?? '—';

    return ListTile(
      leading: Container(
        width: 40.r,
        height: 40.r,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [cs.primaryContainer, cs.tertiaryContainer],
          ),
        ),
        child: Icon(LucideIcons.user, size: 20.r, color: cs.onPrimaryContainer),
      ),
      title: Text(
        t.signedInAs,
        style: context.caption.copyWith(color: cs.onSurfaceVariant),
      ),
      subtitle: Text(
        email,
        style: context.cardTitle.copyWith(
          fontFeatures: const [FontFeature.tabularFigures()],
        ),
      ),
    );
  }
}
