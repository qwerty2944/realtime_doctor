import '../../core/result/result.dart';
import '../repositories/auth_repository.dart';

class SignUpUseCase {
  SignUpUseCase(this._repo);
  final AuthRepository _repo;

  Future<Result<AuthUser>> call({
    required String email,
    required String password,
  }) =>
      _repo.signUp(email: email, password: password);
}
