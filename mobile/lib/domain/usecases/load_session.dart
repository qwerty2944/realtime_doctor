import '../../core/result/result.dart';
import '../repositories/sessions_repository.dart';

class LoadSessionUseCase {
  LoadSessionUseCase(this._repo);
  final SessionsRepository _repo;

  Future<Result<SessionDetail>> call(String sessionId) => _repo.load(sessionId);
}
