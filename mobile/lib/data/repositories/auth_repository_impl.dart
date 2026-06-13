import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'package:supabase_flutter/supabase_flutter.dart' hide AuthUser;

import '../../core/error/failure.dart';
import '../../core/result/result.dart';
import '../../domain/repositories/auth_repository.dart';
import '../../infrastructure/supabase/supabase_client_provider.dart';

part 'auth_repository_impl.g.dart';

class AuthRepositoryImpl implements AuthRepository {
  AuthRepositoryImpl(this._client);
  final SupabaseClient _client;

  AuthUser? _from(User? u) =>
      u == null ? null : AuthUser(id: u.id, email: u.email ?? '');

  @override
  AuthUser? get currentUser => _from(_client.auth.currentUser);

  @override
  Stream<AuthUser?> watchAuthUser() =>
      _client.auth.onAuthStateChange.map((s) => _from(s.session?.user));

  @override
  Future<Result<AuthUser>> signInWithPassword({
    required String email,
    required String password,
  }) async {
    try {
      final res = await _client.auth.signInWithPassword(
        email: email.trim(),
        password: password,
      );
      final u = _from(res.user);
      if (u == null) return const FailureResult(AuthFailure('Login returned no user'));
      return Success(u);
    } on AuthException catch (e) {
      return FailureResult(AuthFailure(e.message));
    } catch (e) {
      return FailureResult(UnknownFailure(e.toString()));
    }
  }

  @override
  Future<Result<AuthUser>> signUp({
    required String email,
    required String password,
  }) async {
    try {
      final res = await _client.auth.signUp(
        email: email.trim(),
        password: password,
      );
      final u = _from(res.user);
      if (u == null) {
        return const FailureResult(
          AuthFailure('회원가입은 성공했지만 즉시 로그인되지 않았습니다. 이메일 확인이 필요할 수 있습니다.'),
        );
      }
      return Success(u);
    } on AuthException catch (e) {
      return FailureResult(AuthFailure(e.message));
    } catch (e) {
      return FailureResult(UnknownFailure(e.toString()));
    }
  }

  @override
  Future<Result<void>> signOut() async {
    try {
      // local 스코프 — 서버 토큰 폐기를 기다리지 않고 즉시 로컬 세션을 지운다.
      // 네트워크 불안정 시에도 로그아웃이 막히지 않는다.
      await _client.auth.signOut(scope: SignOutScope.local);
      return const Success(null);
    } catch (e) {
      return FailureResult(UnknownFailure(e.toString()));
    }
  }
}

@Riverpod(keepAlive: true)
AuthRepository authRepository(Ref ref) {
  return AuthRepositoryImpl(ref.watch(supabaseClientProvider));
}
