import '../../core/result/result.dart';
import '../repositories/auth_repository.dart';

class SignOutUseCase {
  SignOutUseCase(this._repo);
  final AuthRepository _repo;

  Future<Result<void>> call() => _repo.signOut();
}
