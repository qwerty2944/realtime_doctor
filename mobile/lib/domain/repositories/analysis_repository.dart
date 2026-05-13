import '../../core/result/result.dart';
import '../entities/analysis.dart';
import '../entities/dictation.dart';
import '../entities/speaker.dart';
import '../entities/summary.dart';

abstract interface class AnalysisRepository {
  Future<Result<Analysis>> analyze({
    required String language,
    required List<({Speaker speaker, String text})> chunks,
  });

  Future<Result<Summary>> summarize({
    required String language,
    required List<({Speaker speaker, String text})> chunks,
  });

  Future<Result<Dictation>> dictate({
    required String language,
    required DictationTemplate template,
    required List<({Speaker speaker, String text})> chunks,
  });
}
