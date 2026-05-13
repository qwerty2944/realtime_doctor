import '../../core/result/result.dart';
import '../entities/analysis.dart';
import '../entities/dictation.dart';
import '../entities/speaker.dart';
import '../entities/summary.dart';
import '../repositories/analysis_repository.dart';

class RunAnalysisUseCase {
  RunAnalysisUseCase(this._repo);
  final AnalysisRepository _repo;

  Future<Result<Analysis>> call({
    required String language,
    required List<({Speaker speaker, String text})> chunks,
  }) =>
      _repo.analyze(language: language, chunks: chunks);
}

class RunSummaryUseCase {
  RunSummaryUseCase(this._repo);
  final AnalysisRepository _repo;

  Future<Result<Summary>> call({
    required String language,
    required List<({Speaker speaker, String text})> chunks,
  }) =>
      _repo.summarize(language: language, chunks: chunks);
}

class RunDictationUseCase {
  RunDictationUseCase(this._repo);
  final AnalysisRepository _repo;

  Future<Result<Dictation>> call({
    required String language,
    required DictationTemplate template,
    required List<({Speaker speaker, String text})> chunks,
  }) =>
      _repo.dictate(language: language, template: template, chunks: chunks);
}
