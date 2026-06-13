import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../core/error/failure.dart';
import '../../core/result/result.dart';
import '../../core/utils/logger.dart';
import '../../domain/entities/analysis.dart';
import '../../domain/entities/dictation.dart';
import '../../domain/entities/session.dart';
import '../../domain/entities/summary.dart';
import '../../domain/entities/transcript_chunk.dart';
import '../../domain/repositories/capture_repository.dart';
import '../../domain/repositories/sessions_repository.dart';
import '../datasources/remote/sessions_remote_ds.dart';
import '../dtos/analysis_dto.dart';
import '../dtos/dictation_dto.dart';
import '../dtos/summary_dto.dart';
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

      // 방어적 시간순 정렬 — DB 순서가 어긋나도 전사가 거꾸로 나오지 않게.
      final sorted = chunks.map((c) => c.toDomain()).toList()
        ..sort((a, b) => a.timestampMs.compareTo(b.timestampMs));

      return Success(
        SessionDetail(
          session: dto.toDomain(chunkCount: chunks.length),
          chunks: sorted,
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

  @override
  Future<Result<void>> deleteSession(String sessionId) async {
    try {
      await _remote.deleteSession(sessionId);
      return const Success(null);
    } catch (e) {
      return FailureResult(NetworkFailure(e.toString()));
    }
  }

  @override
  Future<Result<void>> deleteChunk(String chunkId) async {
    try {
      await _remote.deleteChunk(chunkId);
      return const Success(null);
    } catch (e) {
      return FailureResult(NetworkFailure(e.toString()));
    }
  }

  @override
  Future<Result<void>> persistCapture({
    required String sessionId,
    required DateTime startedAt,
    required CaptureStopResult stopResult,
    required List<TranscriptChunk> chunks,
    required bool uploadAudio,
  }) async {
    try {
      String? audioPath;
      if (uploadAudio && stopResult.audioWav != null) {
        try {
          audioPath = await _remote.uploadSessionAudio(
            sessionId: sessionId,
            wavBytes: stopResult.audioWav!,
          );
        } catch (e) {
          // 오디오 업로드 실패는 fatal 아님 — 세션/청크 저장은 계속 진행.
          appLogger.w('audio upload failed (continuing): $e');
        }
      }

      await _remote.createSession(
        sessionId: sessionId,
        startedAt: startedAt,
        endedAt: stopResult.endedAt,
        transcribeProvider: stopResult.transcribeProvider,
        audioPath: audioPath,
      );

      if (chunks.isNotEmpty) {
        await _remote.insertChunks(
          sessionId: sessionId,
          chunks: chunks
              .map((c) => (
                    id: c.id,
                    text: c.text,
                    timestampMs: c.timestampMs,
                    speaker: c.speaker.wire,
                  ))
              .toList(),
        );
      }

      return const Success(null);
    } catch (e, st) {
      appLogger.e('persistCapture failed', error: e, stackTrace: st);
      return FailureResult(NetworkFailure(e.toString()));
    }
  }

  @override
  Future<Result<void>> persistAnalysis({
    required String sessionId,
    required Analysis analysis,
  }) async {
    try {
      final dto = AnalysisDto(
        differentialDiagnoses: analysis.differentialDiagnoses
            .map((d) => <String, dynamic>{
                  'name': d.name,
                  'nameEn': d.nameEn,
                  'icd10': d.icd10,
                  'confidence': d.confidence,
                  'reasoning': d.reasoning,
                })
            .toList(),
        medicalTerms: analysis.medicalTerms
            .map((t) => <String, dynamic>{
                  'term': t.term,
                  'termEn': t.termEn,
                  'definition': t.definition,
                  'contextQuote': t.contextQuote,
                })
            .toList(),
        suggestedQuestions: analysis.suggestedQuestions
            .map((q) => <String, dynamic>{
                  'question': q.question,
                  'rationale': q.rationale,
                })
            .toList(),
        redFlags: analysis.redFlags,
        updatedAt: analysis.updatedAt.toIso8601String(),
      );
      await _remote.insertAnalysis(sessionId: sessionId, dto: dto);
      return const Success(null);
    } catch (e) {
      return FailureResult(NetworkFailure(e.toString()));
    }
  }

  @override
  Future<Result<void>> persistSummary({
    required String sessionId,
    required Summary summary,
  }) async {
    try {
      final dto = SummaryDto(
        chiefComplaint: summary.chiefComplaint,
        historyOfPresentIllness: summary.historyOfPresentIllness,
        pertinentFindings: summary.pertinentFindings,
        investigationsMentioned: summary.investigationsMentioned,
        clinicalImpression: summary.clinicalImpression,
        plan: summary.plan,
        generatedAt: summary.generatedAt.toIso8601String(),
      );
      await _remote.insertSummary(sessionId: sessionId, dto: dto);
      return const Success(null);
    } catch (e) {
      return FailureResult(NetworkFailure(e.toString()));
    }
  }

  @override
  Future<Result<void>> persistDictation({
    required String sessionId,
    required Dictation dictation,
  }) async {
    try {
      final dto = DictationDto(
        template: dictation.template.wire,
        sections: dictation.sections
            .map((s) => <String, dynamic>{
                  'heading': s.heading,
                  'body': s.body,
                })
            .toList(),
        generatedAt: dictation.generatedAt.toIso8601String(),
      );
      await _remote.insertDictation(sessionId: sessionId, dto: dto);
      return const Success(null);
    } catch (e) {
      return FailureResult(NetworkFailure(e.toString()));
    }
  }
}

@Riverpod(keepAlive: true)
SessionsRepository sessionsRepository(Ref ref) {
  return SessionsRepositoryImpl(ref.watch(sessionsRemoteDataSourceProvider));
}
