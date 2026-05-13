import '../../core/result/result.dart';
import '../entities/session.dart';
import '../repositories/sessions_repository.dart';

class ListSessionsUseCase {
  ListSessionsUseCase(this._repo);
  final SessionsRepository _repo;

  Future<Result<List<Session>>> call({int limit = 50}) =>
      _repo.listMine(limit: limit);
}
