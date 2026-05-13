import '../entities/speaker.dart';
import '../repositories/capture_repository.dart';

class ClassifySpeakerUseCase {
  ClassifySpeakerUseCase(this._repo);
  final CaptureRepository _repo;

  Future<Speaker> call({
    required String text,
    required List<({Speaker speaker, String text})> history,
  }) =>
      _repo.classifySpeaker(text: text, history: history);
}
