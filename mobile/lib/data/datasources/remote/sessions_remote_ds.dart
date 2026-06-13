import 'dart:typed_data';

import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../../core/constants/app_constants.dart';
import '../../../infrastructure/supabase/supabase_client_provider.dart';
import '../../dtos/analysis_dto.dart';
import '../../dtos/dictation_dto.dart';
import '../../dtos/session_dto.dart';
import '../../dtos/summary_dto.dart';
import '../../dtos/transcript_chunk_dto.dart';

part 'sessions_remote_ds.g.dart';

class SessionsRemoteDataSource {
  SessionsRemoteDataSource(this._client);
  final SupabaseClient _client;

  String get _uid {
    final id = _client.auth.currentUser?.id;
    if (id == null) {
      throw const PostgrestException(message: 'not signed in', code: '401');
    }
    return id;
  }

  // ── reads ─────────────────────────────────────────────────────────────

  Future<List<SessionDto>> listMine({int limit = 50}) async {
    final rows = await _client
        .from(AppConstants.tableSessions)
        .select()
        .order('started_at', ascending: false)
        .limit(limit);
    return rows
        .map<SessionDto>((r) => SessionDto.fromJson(r))
        .toList();
  }

  Future<SessionDto?> findById(String id) async {
    final row = await _client
        .from(AppConstants.tableSessions)
        .select()
        .eq('id', id)
        .maybeSingle();
    if (row == null) return null;
    return SessionDto.fromJson(row);
  }

  Future<List<TranscriptChunkDto>> chunksOf(String sessionId) async {
    final rows = await _client
        .from(AppConstants.tableTranscriptChunks)
        .select()
        .eq('session_id', sessionId)
        // 시간순(오름차순) 명시 — 기본값이 내림차순이라 거꾸로 나오던 문제 수정.
        .order('timestamp_ms', ascending: true);
    return rows.map<TranscriptChunkDto>(TranscriptChunkDto.fromJson).toList();
  }

  Future<AnalysisDto?> analysisOf(String sessionId) async {
    final row = await _client
        .from(AppConstants.tableAnalyses)
        .select()
        .eq('session_id', sessionId)
        .order('updated_at', ascending: false)
        .limit(1)
        .maybeSingle();
    if (row == null) return null;
    return AnalysisDto.fromJson(row);
  }

  Future<SummaryDto?> latestSummaryOf(String sessionId) async {
    final row = await _client
        .from(AppConstants.tableSummaries)
        .select()
        .eq('session_id', sessionId)
        .order('generated_at', ascending: false)
        .limit(1)
        .maybeSingle();
    if (row == null) return null;
    return SummaryDto.fromJson(row);
  }

  Future<DictationDto?> latestDictationOf(String sessionId) async {
    final row = await _client
        .from(AppConstants.tableDictations)
        .select()
        .eq('session_id', sessionId)
        .order('generated_at', ascending: false)
        .limit(1)
        .maybeSingle();
    if (row == null) return null;
    return DictationDto.fromJson(row);
  }

  Future<String?> signedAudioUrl(String? audioPath, {int expiresIn = 3600}) async {
    if (audioPath == null || audioPath.isEmpty) return null;
    return _client.storage
        .from(AppConstants.bucketRecordings)
        .createSignedUrl(audioPath, expiresIn);
  }

  Future<void> setPinned(String id, bool pinned) async {
    await _client
        .from(AppConstants.tableSessions)
        .update({'pinned': pinned})
        .eq('id', id);
  }

  /// 세션 삭제. 자식 행(chunks/analyses/summaries/dictations)은 FK ON DELETE
  /// CASCADE 로 자동 삭제되고, usage_events 는 SET NULL 처리된다.
  Future<void> deleteSession(String id) async {
    await _client.from(AppConstants.tableSessions).delete().eq('id', id);
  }

  /// 개별 발화(transcript chunk) 삭제 — 앱이 발급한 chunk_id 기준.
  Future<void> deleteChunk(String chunkId) async {
    await _client
        .from(AppConstants.tableTranscriptChunks)
        .delete()
        .eq('chunk_id', chunkId);
  }

  // ── writes (capture → persist) ────────────────────────────────────────

  /// session row 를 만들거나 갱신(upsert by PK 'id').
  /// 녹음을 정지→재개하며 같은 논리 세션을 여러 번 저장할 때, 중복 insert
  /// 충돌 없이 ended_at/audio_path 만 갱신되도록 upsert 한다.
  Future<void> createSession({
    required String sessionId,
    required DateTime startedAt,
    required DateTime endedAt,
    required String transcribeProvider,
    String? audioPath,
    String? title,
  }) async {
    await _client.from(AppConstants.tableSessions).upsert({
      'id': sessionId,
      'user_id': _uid,
      'started_at': startedAt.toIso8601String(),
      'ended_at': endedAt.toIso8601String(),
      'transcribe_provider': transcribeProvider,
      if (audioPath != null) 'audio_path': audioPath,
      if (title != null) 'title': title,
    });
  }

  /// chunks 배열을 일괄 insert.
  Future<void> insertChunks({
    required String sessionId,
    required List<({String id, String text, int timestampMs, String speaker})>
        chunks,
  }) async {
    if (chunks.isEmpty) return;
    final rows = chunks
        .map((c) => {
              'chunk_id': c.id,
              'session_id': sessionId,
              'user_id': _uid,
              'text': c.text,
              'timestamp_ms': c.timestampMs,
              'speaker': c.speaker,
            })
        .toList();
    await _client.from(AppConstants.tableTranscriptChunks).insert(rows);
  }

  /// 분석 결과를 insert (한 세션에 여러 버전 누적 가능).
  Future<void> insertAnalysis({
    required String sessionId,
    required AnalysisDto dto,
  }) async {
    await _client.from(AppConstants.tableAnalyses).insert({
      'session_id': sessionId,
      'user_id': _uid,
      'differential_diagnoses': dto.differentialDiagnoses,
      'medical_terms': dto.medicalTerms,
      'suggested_questions': dto.suggestedQuestions,
      'red_flags': dto.redFlags,
      'updated_at': dto.updatedAt,
    });
  }

  Future<void> insertSummary({
    required String sessionId,
    required SummaryDto dto,
  }) async {
    await _client.from(AppConstants.tableSummaries).insert({
      'session_id': sessionId,
      'user_id': _uid,
      'chief_complaint': dto.chiefComplaint,
      'history_of_present_illness': dto.historyOfPresentIllness,
      'pertinent_findings': dto.pertinentFindings,
      'investigations_mentioned': dto.investigationsMentioned,
      'clinical_impression': dto.clinicalImpression,
      'plan': dto.plan,
      'generated_at': dto.generatedAt,
    });
  }

  Future<void> insertDictation({
    required String sessionId,
    required DictationDto dto,
  }) async {
    await _client.from(AppConstants.tableDictations).insert({
      'session_id': sessionId,
      'user_id': _uid,
      'template': dto.template,
      'sections': dto.sections,
      'generated_at': dto.generatedAt,
    });
  }

  /// WAV 바이트를 Supabase Storage 의 recordings 버킷에 업로드. Storage path 반환.
  Future<String> uploadSessionAudio({
    required String sessionId,
    required Uint8List wavBytes,
  }) async {
    final path = '$_uid/$sessionId.wav';
    await _client.storage
        .from(AppConstants.bucketRecordings)
        .uploadBinary(
          path,
          wavBytes,
          fileOptions: const FileOptions(
            contentType: 'audio/wav',
            upsert: true,
          ),
        );
    return path;
  }
}

@Riverpod(keepAlive: true)
SessionsRemoteDataSource sessionsRemoteDataSource(
  Ref ref,
) {
  return SessionsRemoteDataSource(ref.watch(supabaseClientProvider));
}
