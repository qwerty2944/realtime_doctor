import '../../core/result/result.dart';
import '../repositories/capture_repository.dart';

class StopCaptureUseCase {
  StopCaptureUseCase(this._repo);
  final CaptureRepository _repo;

  Future<Result<void>> call({bool uploadAudio = true}) =>
      _repo.stop(uploadAudio: uploadAudio);
}
