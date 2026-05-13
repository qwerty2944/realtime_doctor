import 'dart:async';
import 'dart:typed_data';

import '../../../core/utils/logger.dart';

/// OpenAI Realtime WS wrapper.
///
/// 모바일에서 직접 OPENAI_API_KEY 로 ephemeral key 발급은 보안 위험이라
/// production 은 Supabase Edge Function 으로 mintStreamSession 을 옮겨야 함.
/// v1 은 stub.
class OpenAiRealtimeSession {
  OpenAiRealtimeSession({required this.openaiApiKey});

  final String openaiApiKey;
  final _events = StreamController<({String itemId, String text, bool isFinal})>.broadcast();
  bool _opened = false;

  Stream<({String itemId, String text, bool isFinal})> get events =>
      _events.stream;

  Future<void> open() async {
    if (openaiApiKey.isEmpty || openaiApiKey == 'REPLACE_ME') {
      throw const FormatException(
        'OPENAI_API_KEY 가 설정되지 않았습니다. .env 를 확인하세요.',
      );
    }
    appLogger.w('OpenAI Realtime WS — v1 stub. 실제 mint + WS 미구현.');
    _opened = true;
  }

  /// PCM 16kHz 16-bit mono.
  void sendAudio(Uint8List _) {
    if (!_opened) return;
  }

  Future<void> close() async {
    _opened = false;
    await _events.close();
  }
}
