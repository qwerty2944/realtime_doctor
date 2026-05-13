import 'dart:convert';

import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../core/constants/app_constants.dart';
import '../../core/error/failure.dart';
import '../../core/result/result.dart';
import '../../core/utils/logger.dart';
import '../../domain/entities/analysis.dart';
import '../../domain/entities/dictation.dart';
import '../../domain/entities/speaker.dart';
import '../../domain/entities/summary.dart';
import '../../domain/repositories/analysis_repository.dart';
import '../../infrastructure/env/env.dart';
import '../datasources/remote/gemini_api.dart';
import '../datasources/remote/gemini_api_provider.dart';
import '../dtos/analysis_dto.dart';
import '../dtos/dictation_dto.dart';
import '../dtos/summary_dto.dart';
import '../mappers/analysis_mapper.dart';

part 'analysis_repository_impl.g.dart';

class AnalysisRepositoryImpl implements AnalysisRepository {
  AnalysisRepositoryImpl({required this.gemini, required this.env});

  final GeminiApi gemini;
  final AppEnv env;

  String _labelDoctor(String lang) => lang == 'en' ? 'Doctor' : '의사';
  String _labelPatient(String lang) => lang == 'en' ? 'Patient' : '환자';

  String _buildTranscript(
    String lang,
    List<({Speaker speaker, String text})> chunks,
  ) {
    final lines = chunks.map((c) {
      final tag = switch (c.speaker) {
        Speaker.doctor => _labelDoctor(lang),
        Speaker.patient => _labelPatient(lang),
        Speaker.unknown => '?',
      };
      return '[$tag] ${c.text}';
    });
    return lines.join('\n');
  }

  String _extractText(Map<String, dynamic> resp) {
    try {
      final cands = resp['candidates'] as List?;
      if (cands == null || cands.isEmpty) return '';
      final parts =
          (cands.first as Map<String, dynamic>)['content']['parts'] as List;
      return parts.map((p) => (p as Map)['text'] as String? ?? '').join();
    } catch (_) {
      return '';
    }
  }

  @override
  Future<Result<Analysis>> analyze({
    required String language,
    required List<({Speaker speaker, String text})> chunks,
  }) async {
    try {
      final transcript = _buildTranscript(language, chunks);
      final system = language == 'en'
          ? 'You are a clinical assistant. Receive the transcript and return analysis JSON.'
          : '당신은 임상 보조 도구입니다. 진료 transcript 를 받아 분석 JSON 을 반환하세요.';
      final user = language == 'en'
          ? 'Transcript:\n---\n$transcript\n---\nReturn analysis matching the schema.'
          : '아래 transcript 를 분석하여 schema 에 맞는 JSON 을 반환하세요.\n\n---\n$transcript\n---';

      final body = <String, dynamic>{
        'system_instruction': {
          'parts': [
            {'text': system},
          ],
        },
        'contents': [
          {
            'role': 'user',
            'parts': [
              {'text': user},
            ],
          },
        ],
        'generationConfig': {
          'temperature': 0.2,
          'responseMimeType': 'application/json',
        },
      };

      final resp = await gemini.generate(
        AppConstants.geminiAnalyzerModel,
        env.geminiApiKey,
        body,
      );
      final text = _extractText(resp);
      if (text.isEmpty) {
        return const FailureResult(ServerFailure('Empty analyzer response'));
      }
      final parsed = jsonDecode(text) as Map<String, dynamic>;
      parsed['updated_at'] = DateTime.now().toUtc().toIso8601String();
      return Success(AnalysisDto.fromJson(parsed).toDomain());
    } catch (e, st) {
      appLogger.e('analyze failed', error: e, stackTrace: st);
      return FailureResult(ServerFailure(e.toString()));
    }
  }

  @override
  Future<Result<Summary>> summarize({
    required String language,
    required List<({Speaker speaker, String text})> chunks,
  }) async {
    try {
      final transcript = _buildTranscript(language, chunks);
      final system = language == 'en'
          ? 'Chart-note summarizer. Return JSON conforming to the schema.'
          : '진료 요약 도우미. schema 에 맞는 JSON 을 반환하세요.';
      final body = <String, dynamic>{
        'system_instruction': {
          'parts': [
            {'text': system},
          ],
        },
        'contents': [
          {
            'role': 'user',
            'parts': [
              {
                'text':
                    'Summarize the following transcript.\n---\n$transcript\n---',
              },
            ],
          },
        ],
        'generationConfig': {
          'temperature': 0.2,
          'responseMimeType': 'application/json',
        },
      };
      final resp = await gemini.generate(
        AppConstants.geminiAnalyzerModel,
        env.geminiApiKey,
        body,
      );
      final text = _extractText(resp);
      if (text.isEmpty) {
        return const FailureResult(ServerFailure('Empty summarizer response'));
      }
      final parsed = jsonDecode(text) as Map<String, dynamic>;
      parsed['generated_at'] = DateTime.now().toUtc().toIso8601String();
      return Success(SummaryDto.fromJson(parsed).toDomain());
    } catch (e, st) {
      appLogger.e('summarize failed', error: e, stackTrace: st);
      return FailureResult(ServerFailure(e.toString()));
    }
  }

  @override
  Future<Result<Dictation>> dictate({
    required String language,
    required DictationTemplate template,
    required List<({Speaker speaker, String text})> chunks,
  }) async {
    try {
      final transcript = _buildTranscript(language, chunks);
      final system = language == 'en'
          ? 'EMR dictation. Chart-note prose. Return JSON.'
          : 'EMR 받아쓰기. 의무기록 prose. JSON 반환.';
      final body = <String, dynamic>{
        'system_instruction': {
          'parts': [
            {'text': system},
          ],
        },
        'contents': [
          {
            'role': 'user',
            'parts': [
              {
                'text':
                    'Template: ${template.wire}\nTranscript:\n---\n$transcript\n---',
              },
            ],
          },
        ],
        'generationConfig': {
          'temperature': 0.2,
          'responseMimeType': 'application/json',
        },
      };
      final resp = await gemini.generate(
        AppConstants.geminiAnalyzerModel,
        env.geminiApiKey,
        body,
      );
      final text = _extractText(resp);
      if (text.isEmpty) {
        return const FailureResult(ServerFailure('Empty dictator response'));
      }
      final parsed = jsonDecode(text) as Map<String, dynamic>;
      parsed['template'] = template.wire;
      parsed['generated_at'] = DateTime.now().toUtc().toIso8601String();
      return Success(DictationDto.fromJson(parsed).toDomain());
    } catch (e, st) {
      appLogger.e('dictate failed', error: e, stackTrace: st);
      return FailureResult(ServerFailure(e.toString()));
    }
  }
}

@Riverpod(keepAlive: true)
AnalysisRepository analysisRepository(AnalysisRepositoryRef ref) {
  return AnalysisRepositoryImpl(
    gemini: ref.watch(geminiApiProvider),
    env: ref.watch(envProvider),
  );
}
