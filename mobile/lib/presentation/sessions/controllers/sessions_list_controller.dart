import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/error/failure.dart';
import '../../../core/result/result.dart';
import '../../../data/repositories/sessions_repository_impl.dart';
import '../../../domain/entities/session.dart';

part 'sessions_list_controller.g.dart';

@riverpod
class SessionsListController extends _$SessionsListController {
  @override
  Future<List<Session>> build() async {
    final repo = ref.watch(sessionsRepositoryProvider);
    final res = await repo.listMine();
    return switch (res) {
      Success(value: final v) => v,
      FailureResult(failure: final f) => Future.error(f),
    };
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final res = await ref.read(sessionsRepositoryProvider).listMine();
      return switch (res) {
        Success(value: final v) => v,
        FailureResult(failure: final Failure f) => throw f,
      };
    });
  }

  /// 세션 삭제 — 목록에서 즉시 제거(낙관적), 실패하면 새로고침으로 복구.
  Future<void> delete(String id) async {
    final current = state.value ?? const [];
    state = AsyncData(current.where((s) => s.id != id).toList());
    final res = await ref.read(sessionsRepositoryProvider).deleteSession(id);
    if (res is FailureResult) await refresh();
  }

  /// 즐겨찾기(고정) 토글 — 낙관적 갱신, 실패하면 새로고침으로 복구.
  Future<void> togglePin(Session session) async {
    final next = !session.pinned;
    final current = state.value ?? const [];
    state = AsyncData([
      for (final s in current)
        if (s.id == session.id) s.copyWith(pinned: next) else s,
    ]);
    final res = await ref
        .read(sessionsRepositoryProvider)
        .togglePin(session.id, pinned: next);
    if (res is FailureResult) await refresh();
  }
}
