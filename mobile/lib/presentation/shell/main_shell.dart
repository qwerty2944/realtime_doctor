import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../generated/l10n/app_localizations.dart';

class MainShell extends ConsumerWidget {
  const MainShell({required this.child, super.key});
  final Widget child;

  static const _tabs = <({String path, IconData icon, String Function(AppLocalizations) label})>[
    (path: '/capture', icon: LucideIcons.mic, label: _captureLabel),
    (path: '/sessions', icon: LucideIcons.folder, label: _sessionsLabel),
    (path: '/settings', icon: LucideIcons.settings, label: _settingsLabel),
  ];

  static String _captureLabel(AppLocalizations t) => t.captureTab;
  static String _sessionsLabel(AppLocalizations t) => t.sessionsTab;
  static String _settingsLabel(AppLocalizations t) => t.settingsTab;

  int _indexFor(String location) {
    for (var i = 0; i < _tabs.length; i++) {
      if (location.startsWith(_tabs[i].path)) return i;
    }
    return 1; // default sessions
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final location =
        GoRouterState.of(context).matchedLocation;
    final selected = _indexFor(location);

    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: selected,
        onDestinationSelected: (i) => context.go(_tabs[i].path),
        destinations: [
          for (final tab in _tabs)
            NavigationDestination(
              icon: Icon(tab.icon),
              label: tab.label(t),
            ),
        ],
      ),
    );
  }
}
