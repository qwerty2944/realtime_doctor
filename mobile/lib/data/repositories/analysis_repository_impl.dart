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

  /// 분석 구조화 출력 스키마 — Gemini 가 우리 DTO 키와 정확히 일치하는 JSON 을
  /// 내도록 강제(없으면 모양이 들쭉날쭉해 결과가 비거나 파싱이 깨진다).
  static const Map<String, dynamic> _analysisSchema = {
    'type': 'OBJECT',
    'properties': {
      'differential_diagnoses': {
        'type': 'ARRAY',
        'items': {
          'type': 'OBJECT',
          'properties': {
            'name': {'type': 'STRING'},
            'nameEn': {'type': 'STRING'},
            'icd10': {'type': 'STRING'},
            'confidence': {'type': 'NUMBER'},
            'reasoning': {'type': 'STRING'},
          },
        },
      },
      'medical_terms': {
        'type': 'ARRAY',
        'items': {
          'type': 'OBJECT',
          'properties': {
            'term': {'type': 'STRING'},
            'termEn': {'type': 'STRING'},
            'definition': {'type': 'STRING'},
            'contextQuote': {'type': 'STRING'},
          },
        },
      },
      'suggested_questions': {
        'type': 'ARRAY',
        'items': {
          'type': 'OBJECT',
          'properties': {
            'question': {'type': 'STRING'},
            'rationale': {'type': 'STRING'},
          },
        },
      },
      'red_flags': {
        'type': 'ARRAY',
        'items': {'type': 'STRING'},
      },
    },
  };

  /// 요약 구조화 출력 스키마 — SummaryDto 키(snake_case)와 일치.
  static const Map<String, dynamic> _summarySchema = {
    'type': 'OBJECT',
    'properties': {
      'chief_complaint': {'type': 'STRING'},
      'history_of_present_illness': {'type': 'STRING'},
      'pertinent_findings': {'type': 'STRING'},
      'investigations_mentioned': {'type': 'STRING'},
      'clinical_impression': {'type': 'STRING'},
      'plan': {'type': 'STRING'},
    },
  };

  /// 받아쓰기 구조화 출력 스키마 — DictationDto 의 sections[{heading, body}].
  static const Map<String, dynamic> _dictationSchema = {
    'type': 'OBJECT',
    'properties': {
      'sections': {
        'type': 'ARRAY',
        'items': {
          'type': 'OBJECT',
          'properties': {
            'heading': {'type': 'STRING'},
            'body': {'type': 'STRING'},
          },
        },
      },
    },
  };

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

  /// 모델 JSON 을 객체(Map)로 디코드. 최상위가 배열로 오면 첫 객체를 쓰고,
  /// [listKey] 가 주어지면 배열 전체를 그 키 아래로 감싼다(분석=진단 목록).
  Map<String, dynamic> _decodeObject(String text, {String? listKey}) {
    final decoded = jsonDecode(text);
    if (decoded is Map) return decoded.cast<String, dynamic>();
    if (decoded is List) {
      if (listKey != null) return <String, dynamic>{listKey: decoded};
      final maps = decoded.whereType<Map>().toList();
      return maps.isEmpty ? <String, dynamic>{} : maps.first.cast<String, dynamic>();
    }
    return <String, dynamic>{};
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
          'responseSchema': _analysisSchema,
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
      final parsed = _decodeObject(text, listKey: 'differential_diagnoses');
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
          'responseSchema': _summarySchema,
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
      final parsed = _decodeObject(text);
      parsed['generated_at'] = DateTime.now().toUtc().toIso8601String();
      return Success(SummaryDto.fromJson(parsed).toDomain());
    } catch (e, st) {
      appLogger.e('summarize failed', error: e, stackTrace: st);
      return FailureResult(ServerFailure(e.toString()));
    }
  }

  @override
  Future<Result<List<Speaker>>> diarize({
    required String language,
    required List<String> texts,
  }) async {
    try {
      if (texts.isEmpty) return const Success(<Speaker>[]);
      final numbered = [
        for (var i = 0; i < texts.length; i++) '${i + 1}. ${texts[i]}',
      ].join('\n');
      final system = language == 'en'
          ? 'You label each utterance of a doctor–patient consultation as "doctor" or "patient". Return a "speakers" array in line order.'
          : '의사–환자 진료 대화의 각 발화를 "doctor" 또는 "patient" 로 분류합니다. 줄 순서대로 "speakers" 배열을 반환하세요.';
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
              {'text': '---\n$numbered\n---'},
            ],
          },
        ],
        'generationConfig': {
          'temperature': 0.1,
          'responseMimeType': 'application/json',
          'responseSchema': {
            'type': 'OBJECT',
            'properties': {
              'speakers': {
                'type': 'ARRAY',
                'items': {
                  'type': 'STRING',
                  'enum': ['doctor', 'patient', 'unknown'],
                },
              },
            },
          },
        },
      };
      final resp = await gemini.generate(
        AppConstants.geminiAnalyzerModel,
        env.geminiApiKey,
        body,
      );
      final text = _extractText(resp);
      if (text.isEmpty) return Success(List.filled(texts.length, Speaker.unknown));
      final parsed = _decodeObject(text, listKey: 'speakers');
      final raw = parsed['speakers'];
      final list = (raw is List ? raw : const []).whereType<String>().toList();
      Speaker map(String s) => switch (s.toLowerCase()) {
        'doctor' => Speaker.doctor,
        'patient' => Speaker.patient,
        _ => Speaker.unknown,
      };
      return Success([
        for (var i = 0; i < texts.length; i++)
          i < list.length ? map(list[i]) : Speaker.unknown,
      ]);
    } catch (e, st) {
      appLogger.e('diarize failed', error: e, stackTrace: st);
      return FailureResult(ServerFailure(e.toString()));
    }
  }

  /// 템플릿별 섹션(heading, guidance) — Electron dictator 와 동일 구조.
  (String name, List<(String, String)> sections) _dictationSpec(
    DictationTemplate template,
    String lang,
  ) {
    final en = lang == 'en';
    switch (template) {
      case DictationTemplate.soap:
        return (
          'SOAP',
          en
              ? [
                  ('S — Subjective', "Patient's complaints, symptoms, onset, exacerbating/alleviating factors, relevant history."),
                  ('O — Objective', 'Vital signs, exam findings, mentioned investigations (labs, imaging, ECG).'),
                  ('A — Assessment', 'Most likely impression and ranked differential. Use "likely"/"possible".'),
                  ('P — Plan', 'Workup, prescriptions, procedures, education, follow-up. Only what was mentioned.'),
                ]
              : [
                  ('S — 주관적', '환자의 호소·증상·발생 시점·악화/완화 인자·관련 과거력/사회력을 환자 진술 기반으로 서술.'),
                  ('O — 객관적', '활력징후, 신체검진 소견, 언급된 검사 결과(랩·영상·심전도 등)를 객관적 사실 위주로 서술.'),
                  ('A — 평가', '가장 가능성 높은 임상 인상과 감별진단(가능성 순). 단정 금지, "~가능성" 표현.'),
                  ('P — 계획', '추가 검사·처방·처치·환자 교육·추적 일정 등. 언급된 항목만 기록.'),
                ],
        );
      case DictationTemplate.apso:
        return (
          'APSO',
          en
              ? [
                  ('A — Assessment', 'Most likely impression and ranked differential.'),
                  ('P — Plan', 'Workup, prescriptions, procedures, education, follow-up.'),
                  ('S — Subjective', "Patient's complaints, symptoms, onset, relevant history."),
                  ('O — Objective', 'Vital signs, exam findings, mentioned investigations.'),
                ]
              : [
                  ('A — 평가', '가장 가능성 높은 임상 인상과 감별진단(가능성 순).'),
                  ('P — 계획', '추가 검사·처방·처치·환자 교육·추적 일정.'),
                  ('S — 주관적', '환자의 호소·증상·발생 시점·관련 과거력/사회력.'),
                  ('O — 객관적', '활력징후·신체검진·언급된 검사 결과.'),
                ],
        );
      case DictationTemplate.hp:
        return (
          'H&P',
          en
              ? [
                  ('CC — Chief Complaint', 'One-line reason for the encounter.'),
                  ('HPI — History of Present Illness', 'Onset, character, associated symptoms, timeline.'),
                  ('PMH — Past Medical History', 'Chronic conditions, surgeries, known diagnoses.'),
                  ('Meds — Medications', 'Current medications (mentioned only).'),
                  ('Allergies', 'Drug / food allergies.'),
                  ('FH/SH — Family & Social History', 'Family history; smoking/alcohol/occupation.'),
                  ('ROS — Review of Systems', 'Pertinent positives/negatives across systems.'),
                  ('PE — Physical Exam', 'Vital signs plus system-by-system exam.'),
                  ('Labs/Imaging', 'Mentioned labs, imaging, functional tests.'),
                  ('A/P — Assessment & Plan', 'Combined problem-based impression and plan.'),
                ]
              : [
                  ('CC — 주호소', '내원 사유 한 줄.'),
                  ('HPI — 현병력', '발생 시점·양상·동반 증상·악화/완화 인자·경과를 서술.'),
                  ('PMH — 과거력', '기저질환, 수술력, 입원력, 알려진 질환.'),
                  ('Meds — 복용약', '복용 중인 약물 목록(언급된 것만).'),
                  ('Allergies — 알레르기', '약물·음식 알레르기 이력.'),
                  ('FH/SH — 가족력·사회력', '가족력, 흡연·음주·직업·생활습관.'),
                  ('ROS — 계통 문진', '주요 계통(심혈관·호흡기·위장관 등)의 양성·음성 소견.'),
                  ('PE — 신체검진', '활력징후 + 계통별 신체검진 소견.'),
                  ('Labs/Imaging — 검사 결과', '언급된 랩·영상·기능검사 결과.'),
                  ('A/P — 임상 인상 및 계획', '문제별 인상과 계획을 통합 서술.'),
                ],
        );
      case DictationTemplate.narrative:
        return (
          en ? 'Narrative' : 'Narrative',
          en
              ? [
                  ('Clinical Note', 'A single prose paragraph: identifiers → complaints → findings → impression → plan.'),
                ]
              : [
                  ('진료 기록', '섹션 분리 없이 단일 prose 문단으로 환자 인적사항 → 호소 → 검사·소견 → 임상 인상 → 계획을 자연스럽게.'),
                ],
        );
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
      final en = language == 'en';
      final (name, sections) = _dictationSpec(template, language);
      final sectionsList = [
        for (var i = 0; i < sections.length; i++)
          en
              ? '${i + 1}. ${sections[i].$1}\n   Guidance: ${sections[i].$2}'
              : '${i + 1}. ${sections[i].$1}\n   가이드: ${sections[i].$2}',
      ].join('\n');
      final system = en
          ? 'You are an EMR dictation assistant. Write chart-note prose (narrative, past tense, objective). Use only facts in the transcript; do not invent. For empty sections fill body exactly as "(not mentioned)". No speaker tags in output.'
          : '당신은 EMR 딕테이션 보조 도구입니다. 의무기록 prose(서술형·과거형·객관적)로 작성합니다. transcript에 명시된 사실만 사용하고 추정·창작 금지. 비어 있는 섹션 본문은 정확히 "(언급 없음)". 출력에 화자 라벨 포함 금지.';
      final user = en
          ? 'Convert the following encounter into a chart note using the $name template.\n\n[Required sections — use this order and these exact headings]\n$sectionsList\n\n[Transcript]\n---\n$transcript\n---\n\nReturn every section above (heading copied verbatim, body in prose) matching the JSON schema.'
          : '다음 진료 대화를 $name 템플릿의 의무기록 prose로 정리합니다.\n\n[필수 섹션 — 이 순서·이 heading 그대로 사용]\n$sectionsList\n\n[Transcript]\n---\n$transcript\n---\n\n위 모든 섹션을 빠짐없이(heading 그대로, body는 prose) JSON 스키마에 맞춰 반환하세요.';
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
          'responseSchema': _dictationSchema,
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
      final parsed = _decodeObject(text, listKey: 'sections');
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
AnalysisRepository analysisRepository(Ref ref) {
  return AnalysisRepositoryImpl(
    gemini: ref.watch(geminiApiProvider),
    env: ref.watch(envProvider),
  );
}
