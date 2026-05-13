import '../../core/result/result.dart';
import '../entities/analysis.dart';
import '../entities/dictation.dart';
import '../entities/session.dart';
import '../entities/summary.dart';
import '../entities/transcript_chunk.dart';

class SessionDetail {
  const SessionDetail({
    required this.session,
    required this.chunks,
    this.analysis,
    this.summary,
    this.dictation,
    this.signedAudioUrl,
  });

  final Session session;
  final List<TranscriptChunk> chunks;
  final Analysis? analysis;
  final Summary? summary;
  final Dictation? dictation;
  final String? signedAudioUrl;
}

abstract interface class SessionsRepository {
  Future<Result<List<Session>>> listMine({int limit = 50});
  Future<Result<SessionDetail>> load(String sessionId);
  Future<Result<void>> togglePin(String sessionId, {required bool pinned});
}
