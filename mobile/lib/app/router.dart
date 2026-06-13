import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../infrastructure/supabase/supabase_client_provider.dart';
import '../presentation/auth/screens/login_screen.dart';
import '../presentation/auth/screens/signup_screen.dart';
import '../presentation/capture/screens/capture_screen.dart';
import '../presentation/sessions/screens/session_detail_screen.dart';
import '../presentation/sessions/screens/sessions_list_screen.dart';
import '../presentation/settings/screens/settings_screen.dart';
import '../presentation/shell/main_shell.dart';

part 'router.g.dart';

/// Auth state 변화를 GoRouter 가 감지하도록 listenable 로 어댑팅.
class _RouterRefresh extends ChangeNotifier {
  _RouterRefresh(this._ref) {
    _sub = _ref.listen<AsyncValue>(authStateChangesProvider, (_, __) {
      notifyListeners();
    });
  }
  final Ref _ref;
  late final ProviderSubscription<AsyncValue> _sub;

  @override
  void dispose() {
    _sub.close();
    super.dispose();
  }
}

@Riverpod(keepAlive: true)
GoRouter router(Ref ref) {
  final refresh = _RouterRefresh(ref);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: '/sessions',
    refreshListenable: refresh,
    redirect: (_, state) {
      final session = ref.read(currentSessionProvider);
      final loggedIn = session != null;
      final inAuth = state.matchedLocation.startsWith('/auth');
      if (!loggedIn) return inAuth ? null : '/auth/login';
      if (inAuth) return '/sessions';
      return null;
    },
    routes: [
      GoRoute(
        path: '/auth/login',
        pageBuilder: (_, __) => _fadePage(const LoginScreen()),
      ),
      GoRoute(
        path: '/auth/signup',
        pageBuilder: (_, __) => _fadePage(const SignupScreen()),
      ),
      // StatefulShellRoute.indexedStack — 3개 탭이 각자 자기 Navigator + IndexedStack
      // 안에 살아남아 탭 전환해도 위젯트리/스크롤/컨트롤러 상태가 보존된다.
      StatefulShellRoute.indexedStack(
        builder: (_, __, navShell) => MainShell(navigationShell: navShell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/capture',
                builder: (_, __) => const CaptureScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/sessions',
                builder: (_, __) => const SessionsListScreen(),
                routes: [
                  GoRoute(
                    path: ':id',
                    pageBuilder: (_, s) => _sharedAxisPage(
                      SessionDetailScreen(id: s.pathParameters['id']!),
                    ),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/settings',
                builder: (_, __) => const SettingsScreen(),
              ),
            ],
          ),
        ],
      ),
    ],
  );
}

/// 부드러운 페이드 전환(인증 화면 등).
CustomTransitionPage<void> _fadePage(Widget child) {
  return CustomTransitionPage<void>(
    child: child,
    transitionDuration: const Duration(milliseconds: 280),
    reverseTransitionDuration: const Duration(milliseconds: 220),
    transitionsBuilder: (_, animation, __, child) => FadeTransition(
      opacity: CurvedAnimation(parent: animation, curve: Curves.easeOutCubic),
      child: child,
    ),
  );
}

/// 살짝 밀려 들어오며 페이드(상세 push) — shared-axis 느낌.
CustomTransitionPage<void> _sharedAxisPage(Widget child) {
  return CustomTransitionPage<void>(
    child: child,
    transitionDuration: const Duration(milliseconds: 300),
    reverseTransitionDuration: const Duration(milliseconds: 240),
    transitionsBuilder: (_, animation, __, child) {
      final curved = CurvedAnimation(
        parent: animation,
        curve: Curves.easeOutCubic,
      );
      return FadeTransition(
        opacity: curved,
        child: SlideTransition(
          position: Tween<Offset>(
            begin: const Offset(0.04, 0),
            end: Offset.zero,
          ).animate(curved),
          child: child,
        ),
      );
    },
  );
}
