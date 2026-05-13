import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../generated/l10n/app_localizations.dart';
import '../../auth/controllers/auth_controller.dart';
import '../controllers/settings_controller.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final s = ref.watch(settingsControllerProvider);
    final settingsCtrl = ref.read(settingsControllerProvider.notifier);
    final authCtrl = ref.read(authControllerProvider.notifier);

    return Scaffold(
      appBar: AppBar(title: Text(t.settings)),
      body: ListView(
        padding: EdgeInsets.symmetric(vertical: 8.h),
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(16.w, 16.h, 16.w, 8.h),
            child: Text(
              t.languageLabel,
              style: TextStyle(
                fontSize: 11.sp,
                letterSpacing: 0.5,
                fontWeight: FontWeight.w700,
                color: Theme.of(context).colorScheme.outline,
              ),
            ),
          ),
          RadioGroup<String>(
            groupValue: s.language,
            onChanged: (v) {
              if (v != null) settingsCtrl.setLanguage(v);
            },
            child: Column(
              children: [
                RadioListTile<String>(
                  value: 'ko',
                  title: Text(t.languageKo),
                ),
                RadioListTile<String>(
                  value: 'en',
                  title: Text(t.languageEn),
                ),
              ],
            ),
          ),
          Padding(
            padding: EdgeInsets.fromLTRB(16.w, 4.h, 16.w, 24.h),
            child: Text(
              t.languageFallback,
              style: TextStyle(
                fontSize: 11.sp,
                color: Theme.of(context).colorScheme.outline,
              ),
            ),
          ),
          const Divider(),
          ListTile(
            leading: const Icon(LucideIcons.logOut),
            title: Text(t.signOut),
            onTap: () => authCtrl.signOut(),
          ),
        ],
      ),
    );
  }
}
