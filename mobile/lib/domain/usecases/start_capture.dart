import '../../core/result/result.dart';
import '../repositories/capture_repository.dart';

class StartCaptureUseCase {
  StartCaptureUseCase(this._repo);
  final CaptureRepository _repo;

  Future<Result<Stream<CaptureEvent>>> call({required String language}) =>
      _repo.start(language: language);
}
