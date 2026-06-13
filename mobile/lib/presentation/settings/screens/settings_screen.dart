import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/utils/layout.dart';
import '../../../domain/entities/dictation.dart';
import '../../../generated/l10n/app_localizations.dart';
import '../../auth/controllers/auth_controller.dart';
import '../../common/fx/glass_app_bar.dart';
import '../../common/settings_group.dart';
import '../controllers/dictation_template_controller.dart';
import '../controllers/settings_controller.dart';
import '../widgets/about_section.dart';
import '../widgets/account_section.dart';
import '../widgets/cloud_sync_section.dart';
import '../widgets/mic_permission_section.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final s = ref.watch(settingsControllerProvider);
    final settingsCtrl = ref.read(settingsControllerProvider.notifier);
    // watch 로 구독해야 autoDispose 노티파이어가 화면 수명 동안 살아 있어
    // 탭 시점에 dispose 된 노티파이어를 호출하는 일이 없다.
    final signingOut = ref.watch(authControllerProvider).isLoading;
    final template = ref.watch(dictationTemplateControllerProvider);
    final cs = context.colors;

    String tplLabel(DictationTemplate v) => switch (v) {
      DictationTemplate.soap => t.templateSoap,
      DictationTemplate.apso => t.templateApso,
      DictationTemplate.hp => t.templateHp,
      DictationTemplate.narrative => t.templateNarrative,
    };

    return Scaffold(
      // 리스트가 글래스 앱바 뒤로 흘러 들어가며 블러된다.
      extendBodyBehindAppBar: true,
      appBar: GlassAppBar(title: Text(t.settings)),
      body: ListView(
        padding: EdgeInsets.only(
          top: MediaQuery.paddingOf(context).top + kToolbarHeight,
          // 마지막 그룹과 글래스 탭바 사이에 넉넉한 여백.
          bottom: AppSpacing.xxxl.h * 2 + context.glassNavBarInset,
        ),
        children: [
          SettingsGroup(label: t.account, children: const [AccountSection()]),
          SettingsGroup(
            label: t.permissions,
            children: const [MicPermissionSection()],
          ),
          SettingsGroup(
            label: t.appearanceLabel,
            children: [
              Padding(
                padding: EdgeInsets.all(AppSpacing.lg.r),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(t.themeLabel, style: context.cardBody),
                    SizedBox(height: AppSpacing.sm.h),
                    SizedBox(
                      width: double.infinity,
                      child: SegmentedButton<ThemeMode>(
                        showSelectedIcon: false,
                        segments: [
                          ButtonSegment(
                            value: ThemeMode.system,
                            icon: const Icon(LucideIcons.monitorSmartphone),
                            label: Text(t.themeSystem),
                          ),
                          ButtonSegment(
                            value: ThemeMode.light,
                            icon: const Icon(LucideIcons.sun),
                            label: Text(t.themeLight),
                          ),
                          ButtonSegment(
                            value: ThemeMode.dark,
                            icon: const Icon(LucideIcons.moon),
                            label: Text(t.themeDark),
                          ),
                        ],
                        selected: {s.themeMode},
                        onSelectionChanged: (v) =>
                            settingsCtrl.setThemeMode(v.first),
                      ),
                    ),
                    SizedBox(height: AppSpacing.lg.h),
                    Text(t.languageLabel, style: context.cardBody),
                    SizedBox(height: AppSpacing.sm.h),
                    SizedBox(
                      width: double.infinity,
                      child: SegmentedButton<String>(
                        showSelectedIcon: false,
                        segments: [
                          ButtonSegment(value: 'ko', label: Text(t.languageKo)),
                          ButtonSegment(value: 'en', label: Text(t.languageEn)),
                        ],
                        selected: {s.language},
                        onSelectionChanged: (v) =>
                            settingsCtrl.setLanguage(v.first),
                      ),
                    ),
                    SizedBox(height: AppSpacing.sm.h),
                    Text(t.languageFallback, style: context.caption),
                  ],
                ),
              ),
            ],
          ),
          SettingsGroup(
            label: t.cloudSync,
            children: const [CloudSyncSection()],
          ),
          SettingsGroup(
            label: t.defaultDictationTemplate,
            children: [
              Padding(
                padding: EdgeInsets.all(AppSpacing.lg.r),
                child: Wrap(
                  spacing: AppSpacing.sm.w,
                  runSpacing: AppSpacing.sm.h,
                  children: [
                    for (final tpl in DictationTemplate.values)
                      ChoiceChip(
                        label: Text(tplLabel(tpl)),
                        selected: template == tpl,
                        selectedColor: cs.primaryContainer,
                        onSelected: (sel) {
                          if (sel) {
                            ref
                                .read(
                                  dictationTemplateControllerProvider.notifier,
                                )
                                .setTemplate(tpl);
                          }
                        },
                      ),
                  ],
                ),
              ),
            ],
          ),
          SettingsGroup(
            children: [
              ListTile(
                leading: signingOut
                    ? SizedBox(
                        width: 20.r,
                        height: 20.r,
                        child: const CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Icon(LucideIcons.logOut, color: cs.error),
                title: Text(t.signOut, style: TextStyle(color: cs.error)),
                enabled: !signingOut,
                onTap: () =>
                    ref.read(authControllerProvider.notifier).signOut(),
              ),
            ],
          ),
          SettingsGroup(label: t.about, children: const [AboutSection()]),
        ],
      ),
    );
  }
}
