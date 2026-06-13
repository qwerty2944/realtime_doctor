import 'dart:typed_data';

import '../../core/result/result.dart';
import '../entities/speaker.dart';

class CaptureEvent {
  const CaptureEvent({required this.itemId, required this.text, required this.isFinal});
  final String itemId;
  final String text;
  final bool isFinal;
}

/// stop() 직후 호출자에게 반환되는 세션 메타 + (옵션) 누적 WAV.
///
/// CaptureController 는 이걸 SessionsRepository.persistCapture 로 넘겨 DB/Storage 에 저장.
class CaptureStopResult {
  const CaptureStopResult({
    required this.sessionId,
    required this.language,
    required this.transcribeProvider,
    required this.startedAt,
    required this.endedAt,
    this.audioWav,
  });

  final String sessionId;
  final String language;
  final String transcribeProvider; // 'openai-realtime' | 'gemini-chunk' 등
  final DateTime startedAt;
  final DateTime endedAt;
  final Uint8List? audioWav;
}

abstract interface class CaptureRepository {
  /// 마이크 + STT stream 을 시작. 호출자는 이벤트 stream 을 listen.
  /// language: 'en' → OpenAI Realtime WebSocket, 'ko' → Gemini chunk.
  Future<Result<Stream<CaptureEvent>>> start({required String language});

  /// 마이크/스트림 정지 + 누적 PCM → WAV 인코딩. 저장은 호출자(Controller) 책임.
  Future<Result<CaptureStopResult>> stop();

  /// (옵션) 단일 발화의 화자 분류 use case 용 hook.
  Future<Speaker> classifySpeaker({
    required String text,
    required List<({Speaker speaker, String text})> history,
  });
}
