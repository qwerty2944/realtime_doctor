import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

import '../../../core/constants/app_constants.dart';
import '../../../core/utils/logger.dart';
import '../../../core/utils/wav.dart';
import 'realtime_transcriber.dart';

const _kPromptKo =
    '진료 대화 오디오입니다. 들리는 그대로 한국어로 받아쓰세요. 음차/병기 금지. 영어로 말한 의학 용어는 영어 그대로(예: MRI, BP). 받아쓴 텍스트만 출력, 다른 설명 금지.';
const _kPromptEn =
    'Clinical encounter audio. Transcribe faithfully in English. Keep medical terms exactly as spoken (e.g. MRI, BP, amoxicillin). Output only the transcription, no commentary.';

/// Gemini multimodal generateContent 를 청크 단위로 호출하는 전사 세션.
///
/// 일렉트론의 Gemini fallback 경로와 동일. PCM16 24kHz mono 를 N초씩 누적해
/// WAV 로 인코딩 → inline_data 로 전송 → 텍스트만 받아 emit.
///
/// 진정한 streaming 은 아니지만 mobile 환경에서 OpenAI Realtime 없이 전사를
/// 돌릴 수 있는 가장 안정적인 경로.
class GeminiChunkSession implements RealtimeTranscriber {
  GeminiChunkSession({
    required this.dio,
    required this.apiKey,
    required this.model,
    required this.language,
    this.chunkInterval = const Duration(seconds: 4),
  });

  final Dio dio;
  final String apiKey;
  final String model;
  final String language;
  final Duration chunkInterval;

  final BytesBuilder _buf = BytesBuilder();
  final StreamController<TranscribeEvent> _events =
      StreamController<TranscribeEvent>.broadcast();
  Timer? _flushTimer;
  bool _flushing = false;
  bool _closed = false;
  int _seq = 0;

  /// 4초 = 24000 * 2byte * 4 = 192000 bytes. 그 이상 쌓이면 강제 flush.
  int get _maxBufBytes =>
      AppConstants.audioSampleRate * 2 * chunkInterval.inSeconds * 2;

  @override
  Stream<TranscribeEvent> get events => _events.stream;

  @override
  Future<void> open() async {
    _flushTimer = Timer.periodic(chunkInterval, (_) => _flush());
  }

  @override
  void sendAudio(Uint8List pcm) {
    if (_closed) return;
    _buf.add(pcm);
    if (_buf.length >= _maxBufBytes) {
      // 너무 많이 쌓이면 즉시 flush 한 번 (다음 interval 대기 안 함).
      unawaited(_flush());
    }
  }

  Future<void> _flush() async {
    if (_flushing || _closed) return;
    if (_buf.length == 0) return;
    _flushing = true;
    final pcm = _buf.takeBytes();
    try {
      final wav = pcm16ToWav(pcm);
      final b64 = base64Encode(wav);
      final prompt = language == 'en' ? _kPromptEn : _kPromptKo;
      final body = <String, dynamic>{
        'contents': [
          {
            'parts': [
              {
                'inline_data': {
                  'mime_type': 'audio/wav',
                  'data': b64,
                },
              },
              {'text': prompt},
            ],
          },
        ],
        'generationConfig': {'temperature': 0.0},
      };
      final res = await dio.post<Map<String, dynamic>>(
        'https://generativelanguage.googleapis.com/v1beta/models/${Uri.encodeComponent(model)}:generateContent',
        queryParameters: {'key': apiKey},
        data: body,
      );
      final text = _extractText(res.data ?? <String, dynamic>{});
      if (text.isNotEmpty && !_closed && !_events.isClosed) {
        final id = 'gem-${DateTime.now().millisecondsSinceEpoch}-${_seq++}';
        _events.add(TranscribeEvent(itemId: id, text: text, isFinal: true));
      }
    } catch (e, st) {
      appLogger.w('Gemini chunk transcribe failed: $e', stackTrace: st);
    } finally {
      _flushing = false;
    }
  }

  String _extractText(Map<String, dynamic> resp) {
    try {
      final cands = resp['candidates'] as List?;
      if (cands == null || cands.isEmpty) return '';
      final content = (cands.first as Map)['content'] as Map?;
      if (content == null) return '';
      final parts = content['parts'] as List?;
      if (parts == null) return '';
      return parts
          .map((p) => (p as Map)['text'] as String? ?? '')
          .join()
          .trim();
    } catch (_) {
      return '';
    }
  }

  @override
  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    _flushTimer?.cancel();
    _flushTimer = null;
    // 남은 버퍼 마지막 flush.
    await _flush();
    if (!_events.isClosed) await _events.close();
  }
}
