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
}
