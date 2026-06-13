import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/error/failure.dart';
import '../../../core/result/result.dart';
import '../../../data/repositories/auth_repository_impl.dart';
import '../../../domain/repositories/auth_repository.dart';

part 'auth_controller.g.dart';

@riverpod
class AuthController extends _$AuthController {
  @override
  FutureOr<void> build() => null;

  AuthRepository get _repo => ref.read(authRepositoryProvider);

  Future<Failure?> signIn(String email, String password) async {
    state = const AsyncLoading();
    final res = await _repo.signInWithPassword(
      email: email,
      password: password,
    );
    if (ref.mounted) state = const AsyncData(null);
    return res is FailureResult<AuthUser> ? res.failure : null;
  }

  Future<Failure?> signUp(String email, String password) async {
    state = const AsyncLoading();
    final res = await _repo.signUp(email: email, password: password);
    if (ref.mounted) state = const AsyncData(null);
    return res is FailureResult<AuthUser> ? res.failure : null;
  }

  Future<void> signOut() async {
    state = const AsyncLoading();
    await _repo.signOut();
    if (ref.mounted) state = const AsyncData(null);
  }
}
