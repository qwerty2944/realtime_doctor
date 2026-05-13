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
        .order('timestamp_ms');
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
}

@Riverpod(keepAlive: true)
SessionsRemoteDataSource sessionsRemoteDataSource(
  SessionsRemoteDataSourceRef ref,
) {
  return SessionsRemoteDataSource(ref.watch(supabaseClientProvider));
}
