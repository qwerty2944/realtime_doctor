import '../../core/result/result.dart';
import '../entities/analysis.dart';
import '../entities/dictation.dart';
import '../entities/session.dart';
import '../entities/summary.dart';
import '../entities/transcript_chunk.dart';
import 'capture_repository.dart';

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
  Future<Result<void>> deleteSession(String sessionId);
  Future<Result<void>> deleteChunk(String chunkId);

  /// 캡처 종료 시점에 호출. session row(upsert) + transcript_chunks + (옵션) 오디오.
  ///
  /// [sessionId]/[startedAt] 는 논리 캡처 세션 식별자와 최초 시작 시각으로,
  /// 정지→재개를 반복해도 같은 값을 넘겨 같은 세션에 누적 저장한다.
  /// [chunks] 는 이번 라운드에 **새로 추가된** 발화만 넘긴다(이미 저장된 건 제외).
  Future<Result<void>> persistCapture({
    required String sessionId,
    required DateTime startedAt,
    required CaptureStopResult stopResult,
    required List<TranscriptChunk> chunks,
    required bool uploadAudio,
  });

  Future<Result<void>> persistAnalysis({
    required String sessionId,
    required Analysis analysis,
  });
  Future<Result<void>> persistSummary({
    required String sessionId,
    required Summary summary,
  });
  Future<Result<void>> persistDictation({
    required String sessionId,
    required Dictation dictation,
  });
}
