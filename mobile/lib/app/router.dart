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
GoRouter router(RouterRef ref) {
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
        builder: (_, __) => const LoginScreen(),
      ),
      GoRoute(
        path: '/auth/signup',
        builder: (_, __) => const SignupScreen(),
      ),
      ShellRoute(
        builder: (_, __, child) => MainShell(child: child),
        routes: [
          GoRoute(
            path: '/capture',
            builder: (_, __) => const CaptureScreen(),
          ),
          GoRoute(
            path: '/sessions',
            builder: (_, __) => const SessionsListScreen(),
            routes: [
              GoRoute(
                path: ':id',
                builder: (_, s) =>
                    SessionDetailScreen(id: s.pathParameters['id']!),
              ),
            ],
          ),
          GoRoute(
            path: '/settings',
            builder: (_, __) => const SettingsScreen(),
          ),
        ],
      ),
    ],
  );
}
