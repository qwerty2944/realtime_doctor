import '../../core/result/result.dart';

class AuthUser {
  const AuthUser({required this.id, required this.email});
  final String id;
  final String email;
}

abstract interface class AuthRepository {
  Stream<AuthUser?> watchAuthUser();
  AuthUser? get currentUser;
  Future<Result<AuthUser>> signInWithPassword({
    required String email,
    required String password,
  });
  Future<Result<AuthUser>> signUp({
    required String email,
    required String password,
  });
  Future<Result<void>> signOut();
}
