import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../generated/l10n/app_localizations.dart';
import '../../common/empty_view.dart';
import '../../common/error_view.dart';
import '../../common/loading_view.dart';
import '../controllers/sessions_list_controller.dart';
import '../widgets/session_card.dart';

class SessionsListScreen extends ConsumerWidget {
  const SessionsListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final state = ref.watch(sessionsListControllerProvider);
    return Scaffold(
      appBar: AppBar(title: Text(t.sessionsTitle)),
      body: state.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(
          message: e.toString(),
          onRetry: () =>
              ref.read(sessionsListControllerProvider.notifier).refresh(),
        ),
        data: (sessions) {
          if (sessions.isEmpty) {
            return EmptyView(
              message: t.sessionsEmpty,
              icon: LucideIcons.inbox,
            );
          }
          return RefreshIndicator(
            onRefresh: () =>
                ref.read(sessionsListControllerProvider.notifier).refresh(),
            child: ListView.builder(
              padding: EdgeInsets.symmetric(vertical: 8.h),
              itemCount: sessions.length,
              itemBuilder: (_, i) {
                final s = sessions[i];
                return SessionCard(
                  session: s,
                  onTap: () => context.go('/sessions/${s.id}'),
                );
              },
            ),
          );
        },
      ),
    );
  }
}
