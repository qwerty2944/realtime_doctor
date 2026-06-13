import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:web_socket_channel/io.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

import '../../../core/utils/logger.dart';
import 'realtime_transcriber.dart';

const _kPromptKo =
    '한국 의료 진료 대화를 들리는 그대로 충실히 받아 적습니다. 한국어로 말한 부분은 한국어, 영어로 말한 부분(MRI, BP, amoxicillin 등)은 그 영어 그대로. 음차/병기/의역 금지. 숫자와 단위는 아라비아 숫자로.';

const _kPromptEn =
    'Transcribe a clinical encounter. The output MUST be in English only, using Latin characters. If the speaker uses Korean or any non-English language, render the closest English equivalent — never emit Hangul or other non-Latin scripts. Keep medical terms (e.g. MRI, BP, amoxicillin) exactly as spoken. Do not translate doses or numeric values.';

/// OpenAI Realtime API 의 transcription-only 모드 WebSocket 클라이언트.
///
/// `pcm16` 24kHz mono 를 base64 로 인코딩해 `input_audio_buffer.append` 로 보내고,
/// `conversation.item.input_audio_transcription.delta` / `.completed` 를 받아 emit.
///
/// 일렉트론의 OpenAI Realtime 경로와 동일한 사용감을 모바일에서 직접 제공.
class OpenAiRealtimeSession implements RealtimeTranscriber {
  OpenAiRealtimeSession({
    required this.openaiApiKey,
    required this.model,
    required this.language,
  });

  final String openaiApiKey;
  final String model;
  final String language;

  WebSocketChannel? _ws;
  StreamSubscription<dynamic>? _wsSub;
  final StreamController<TranscribeEvent> _events =
      StreamController<TranscribeEvent>.broadcast();
  final Map<String, String> _partials = {};
  bool _closed = false;

  @override
  Stream<TranscribeEvent> get events => _events.stream;

  @override
  Future<void> open() async {
    if (openaiApiKey.isEmpty || openaiApiKey == 'REPLACE_ME') {
      throw const FormatException(
        'OPENAI_API_KEY 가 설정되지 않았습니다. .env 를 확인하세요.',
      );
    }
    final ws = IOWebSocketChannel.connect(
      Uri.parse('wss://api.openai.com/v1/realtime?intent=transcription'),
      headers: {
        'Authorization': 'Bearer $openaiApiKey',
        'OpenAI-Beta': 'realtime=v1',
      },
    );
    _ws = ws;
    _wsSub = ws.stream.listen(_onMessage, onError: _onError, onDone: _onDone);

    final prompt = language == 'en' ? _kPromptEn : _kPromptKo;
    ws.sink.add(jsonEncode({
      'type': 'session.update',
      'session': {
        'input_audio_format': 'pcm16',
        'input_audio_transcription': {
          'model': model,
          'language': language,
          'prompt': prompt,
        },
        'turn_detection': {
          'type': 'server_vad',
          'threshold': 0.5,
          'prefix_padding_ms': 300,
          'silence_duration_ms': 500,
        },
      },
    }));
  }

  void _onMessage(dynamic raw) {
    if (_closed) return;
    try {
      final Map<String, dynamic> evt =
          jsonDecode(raw as String) as Map<String, dynamic>;
      final type = evt['type'] as String?;
      switch (type) {
        case 'conversation.item.input_audio_transcription.delta':
          final itemId = (evt['item_id'] as String?) ?? '';
          final delta = (evt['delta'] as String?) ?? '';
          if (delta.isEmpty) return;
          final next = (_partials[itemId] ?? '') + delta;
          _partials[itemId] = next;
          if (!_events.isClosed) {
            _events.add(TranscribeEvent(
              itemId: itemId,
              text: next,
              isFinal: false,
            ));
          }
          break;
        case 'conversation.item.input_audio_transcription.completed':
          final itemId = (evt['item_id'] as String?) ?? '';
          final transcript = ((evt['transcript'] as String?) ??
                  _partials[itemId] ??
                  '')
              .trim();
          _partials.remove(itemId);
          if (transcript.isNotEmpty && !_events.isClosed) {
            _events.add(TranscribeEvent(
              itemId: itemId,
              text: transcript,
              isFinal: true,
            ));
          }
          break;
        case 'error':
          appLogger.w('OpenAI Realtime error: ${evt['error']}');
          break;
      }
    } catch (e) {
      appLogger.w('OpenAI Realtime parse error: $e');
    }
  }

  void _onError(Object err) {
    appLogger.e('OpenAI Realtime WS error', error: err);
    if (!_events.isClosed) _events.addError(err);
  }

  void _onDone() {
    appLogger.i('OpenAI Realtime WS closed');
  }

  @override
  void sendAudio(Uint8List pcm) {
    final ws = _ws;
    if (ws == null || _closed) return;
    final b64 = base64Encode(pcm);
    ws.sink.add(jsonEncode({
      'type': 'input_audio_buffer.append',
      'audio': b64,
    }));
  }

  @override
  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    try {
      _ws?.sink.add(jsonEncode({'type': 'input_audio_buffer.commit'}));
    } catch (_) {}
    await _wsSub?.cancel();
    _wsSub = null;
    try {
      await _ws?.sink.close();
    } catch (_) {}
    _ws = null;
    if (!_events.isClosed) await _events.close();
  }
}
