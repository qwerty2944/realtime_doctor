import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:flutter_slidable/flutter_slidable.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/utils/layout.dart';
import '../../../domain/entities/session.dart';
import '../../../generated/l10n/app_localizations.dart';
import '../../common/confirm_dialog.dart';
import '../../common/empty_view.dart';
import '../../common/error_view.dart';
import '../../common/fade_slide_in.dart';
import '../../common/fx/glass_app_bar.dart';
import '../../common/loading_view.dart';
import '../controllers/sessions_list_controller.dart';
import '../widgets/session_card.dart';

class SessionsListScreen extends ConsumerWidget {
  const SessionsListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final state = ref.watch(sessionsListControllerProvider);
    // 리스트가 글래스 앱바 뒤로 흘러 들어가며 블러된다.
    final topInset = MediaQuery.paddingOf(context).top + kToolbarHeight;
    return Scaffold(
      extendBodyBehindAppBar: true,
      appBar: GlassAppBar(title: Text(t.sessionsTitle)),
      body: state.when(
        loading: () => const LoadingView(),
        error: (e, _) => ErrorView(
          message: e.toString(),
          onRetry: () =>
              ref.read(sessionsListControllerProvider.notifier).refresh(),
        ),
        data: (sessions) {
          if (sessions.isEmpty) {
            return EmptyView(message: t.sessionsEmpty, icon: LucideIcons.inbox);
          }
          return RefreshIndicator(
            edgeOffset: topInset,
            onRefresh: () =>
                ref.read(sessionsListControllerProvider.notifier).refresh(),
            child: ListView.builder(
              padding: EdgeInsets.only(
                top: topInset + 8.h,
                bottom: 8.h + context.glassNavBarInset,
              ),
              itemCount: sessions.length,
              itemBuilder: (_, i) {
                final s = sessions[i];
                return FadeSlideIn(
                  index: i,
                  child: _SlidableSessionCard(
                    session: s,
                    onTap: () => context.go('/sessions/${s.id}'),
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}

/// 카카오톡 풍 스와이프 액션 카드 — 오른쪽으로 밀면 즐겨찾기, 왼쪽으로 밀면 삭제.
class _SlidableSessionCard extends ConsumerWidget {
  const _SlidableSessionCard({required this.session, required this.onTap});

  final Session session;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final cs = context.colors;
    final ctrl = ref.read(sessionsListControllerProvider.notifier);

    Future<bool> confirmDelete() => showConfirmDialog(
          context,
          title: t.deleteSessionTitle,
          message: t.deleteSessionBody,
          confirmLabel: t.delete,
          cancelLabel: t.cancel,
          destructive: true,
        );

    return Slidable(
      key: ValueKey(session.id),
      // 오른쪽으로 밀기 → 즐겨찾기 토글.
      startActionPane: ActionPane(
        motion: const DrawerMotion(),
        extentRatio: 0.28,
        children: [
          SlidableAction(
            onPressed: (_) => ctrl.togglePin(session),
            backgroundColor: cs.tertiaryContainer,
            foregroundColor: cs.onTertiaryContainer,
            borderRadius: AppRadius.mdAll,
            icon: session.pinned ? LucideIcons.starOff : LucideIcons.star,
            label: session.pinned ? t.unfavorite : t.favorite,
          ),
        ],
      ),
      // 왼쪽으로 밀기 → 삭제(확인 후). 끝까지 밀어도 확인을 거친다.
      endActionPane: ActionPane(
        motion: const DrawerMotion(),
        extentRatio: 0.28,
        children: [
          SlidableAction(
            onPressed: (_) async {
              if (await confirmDelete()) ctrl.delete(session.id);
            },
            backgroundColor: cs.errorContainer,
            foregroundColor: cs.onErrorContainer,
            borderRadius: AppRadius.mdAll,
            icon: LucideIcons.trash2,
            label: t.delete,
          ),
        ],
      ),
      child: SessionCard(session: session, onTap: onTap),
    );
  }
}
