import 'dart:async';
import 'dart:typed_data';

import '../../../core/utils/logger.dart';

/// CLOVA Speech Streaming WS wrapper.
///
/// 정확한 endpoint·인증·gRPC frame 포맷은 NCP CLOVA Speech 도메인 별로 다름.
/// Electron 의 `src/main/clovaStream.ts` 를 그대로 모바일에 포팅하는 것이
/// v1.1 작업이며, v1 에서는 stub: 일부 회로가 구현되어 있다는 사실만 표명.
class ClovaStreamSession {
  ClovaStreamSession({required this.clovaSpeechSecret});

  final String clovaSpeechSecret;
  final _events = StreamController<({String itemId, String text, bool isFinal})>.broadcast();
  bool _opened = false;

  Stream<({String itemId, String text, bool isFinal})> get events =>
      _events.stream;

  Future<void> open() async {
    if (clovaSpeechSecret.isEmpty || clovaSpeechSecret == 'REPLACE_ME') {
      throw const FormatException(
        'CLOVA_SPEECH_SECRET 가 설정되지 않았습니다. .env 를 확인하세요.',
      );
    }
    appLogger.w('CLOVA Stream WS — v1 stub. 실제 WS 연결 미구현.');
    _opened = true;
  }

  /// PCM 16kHz 16-bit mono.
  void sendAudio(Uint8List _) {
    if (!_opened) return;
    // TODO(clova): NCP CLOVA Speech Streaming gRPC frame 으로 send.
  }

  Future<void> close() async {
    _opened = false;
    await _events.close();
  }
}
