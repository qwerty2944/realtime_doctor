import 'dart:typed_data';

/// 한 utterance(혹은 partial)에 대한 이벤트.
class TranscribeEvent {
  const TranscribeEvent({
    required this.itemId,
    required this.text,
    required this.isFinal,
  });
  final String itemId;
  final String text;
  final bool isFinal;
}

/// 모바일에서 사용 가능한 모든 전사 소스의 공통 인터페이스.
///
/// 일렉트론은 OpenAI Realtime + CLOVA gRPC 두 stream 을 지원했고, 모바일은
/// OpenAI Realtime WebSocket(영어) + Gemini chunk(한국어) 조합으로 같은 UX 를 낸다.
abstract class RealtimeTranscriber {
  Future<void> open();
  void sendAudio(Uint8List pcm);
  Stream<TranscribeEvent> get events;
  Future<void> close();
}
