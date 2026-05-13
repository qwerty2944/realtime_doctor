import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/error/failure.dart';
import '../../../core/result/result.dart';
import '../../../data/repositories/sessions_repository_impl.dart';
import '../../../domain/repositories/sessions_repository.dart';

part 'session_detail_controller.g.dart';

@riverpod
class SessionDetailController extends _$SessionDetailController {
  @override
  Future<SessionDetail> build(String sessionId) async {
    final res = await ref.read(sessionsRepositoryProvider).load(sessionId);
    return switch (res) {
      Success(value: final v) => v,
      FailureResult(failure: final Failure f) => throw f,
    };
  }
}
