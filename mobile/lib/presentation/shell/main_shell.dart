import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../generated/l10n/app_localizations.dart';

/// `StatefulShellRoute.indexedStack` 의 셸. `navigationShell` 자체가 IndexedStack
/// 위젯이라 body 로 그대로 꽂으면 3개 브랜치가 항상 mount 상태로 유지된다.
class MainShell extends ConsumerWidget {
  const MainShell({required this.navigationShell, super.key});

  final StatefulNavigationShell navigationShell;

  static const _tabs =
      <({IconData icon, String Function(AppLocalizations) label})>[
        (icon: LucideIcons.mic, label: _captureLabel),
        (icon: LucideIcons.folder, label: _sessionsLabel),
        (icon: LucideIcons.settings, label: _settingsLabel),
      ];

  static String _captureLabel(AppLocalizations t) => t.captureTab;
  static String _sessionsLabel(AppLocalizations t) => t.sessionsTab;
  static String _settingsLabel(AppLocalizations t) => t.settingsTab;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final selected = navigationShell.currentIndex;

    return Scaffold(
      // 콘텐츠가 글래스 탭바 뒤로 비치도록 body 를 바 영역까지 확장.
      extendBody: true,
      body: navigationShell,
      bottomNavigationBar: _GlassNavBar(
        selectedIndex: selected,
        onDestinationSelected: (i) => navigationShell.goBranch(
          i,
          // 같은 탭을 다시 누르면 그 브랜치의 초기 라우트(예: /sessions)로 pop.
          initialLocation: i == selected,
        ),
        destinations: [
          for (final tab in _tabs)
            NavigationDestination(icon: Icon(tab.icon), label: tab.label(t)),
        ],
      ),
    );
  }
}

/// 엣지투엣지 글래스모피즘 하단 탭바.
class _GlassNavBar extends StatelessWidget {
  const _GlassNavBar({
    required this.selectedIndex,
    required this.onDestinationSelected,
    required this.destinations,
  });

  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;
  final List<NavigationDestination> destinations;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: scheme.surface.withValues(alpha: 0.72),
            border: Border(
              top: BorderSide(
                color: scheme.outlineVariant.withValues(alpha: 0.5),
                width: 0.5,
              ),
            ),
          ),
          child: NavigationBar(
            backgroundColor: Colors.transparent,
            elevation: 0,
            selectedIndex: selectedIndex,
            onDestinationSelected: onDestinationSelected,
            destinations: destinations,
          ),
        ),
      ),
    );
  }
}
