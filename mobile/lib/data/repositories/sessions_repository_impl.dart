import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../core/error/failure.dart';
import '../../core/result/result.dart';
import '../../domain/entities/session.dart';
import '../../domain/repositories/sessions_repository.dart';
import '../datasources/remote/sessions_remote_ds.dart';
import '../mappers/analysis_mapper.dart';
import '../mappers/session_mapper.dart';

part 'sessions_repository_impl.g.dart';

class SessionsRepositoryImpl implements SessionsRepository {
  SessionsRepositoryImpl(this._remote);
  final SessionsRemoteDataSource _remote;

  @override
  Future<Result<List<Session>>> listMine({int limit = 50}) async {
    try {
      final dtos = await _remote.listMine(limit: limit);
      final sessions = dtos.map((d) => d.toDomain()).toList();
      return Success(sessions);
    } catch (e) {
      return FailureResult(NetworkFailure(e.toString()));
    }
  }

  @override
  Future<Result<SessionDetail>> load(String sessionId) async {
    try {
      final dto = await _remote.findById(sessionId);
      if (dto == null) {
        return const FailureResult(NetworkFailure('Session not found'));
      }
      final chunks = await _remote.chunksOf(sessionId);
      final analysis = await _remote.analysisOf(sessionId);
      final summary = await _remote.latestSummaryOf(sessionId);
      final dictation = await _remote.latestDictationOf(sessionId);
      final signed = await _remote.signedAudioUrl(dto.audioPath);

      return Success(
        SessionDetail(
          session: dto.toDomain(chunkCount: chunks.length),
          chunks: chunks.map((c) => c.toDomain()).toList(),
          analysis: analysis?.toDomain(),
          summary: summary?.toDomain(),
          dictation: dictation?.toDomain(),
          signedAudioUrl: signed,
        ),
      );
    } catch (e) {
      return FailureResult(NetworkFailure(e.toString()));
    }
  }

  @override
  Future<Result<void>> togglePin(String sessionId, {required bool pinned}) async {
    try {
      await _remote.setPinned(sessionId, pinned);
      return const Success(null);
    } catch (e) {
      return FailureResult(NetworkFailure(e.toString()));
    }
  }
}

@Riverpod(keepAlive: true)
SessionsRepository sessionsRepository(SessionsRepositoryRef ref) {
  return SessionsRepositoryImpl(ref.watch(sessionsRemoteDataSourceProvider));
}
