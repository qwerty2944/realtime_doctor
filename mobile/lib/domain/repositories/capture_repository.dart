import '../../core/result/result.dart';
import '../entities/speaker.dart';

class CaptureEvent {
  const CaptureEvent({required this.itemId, required this.text, required this.isFinal});
  final String itemId;
  final String text;
  final bool isFinal;
}

abstract interface class CaptureRepository {
  /// 마이크 + STT stream 을 시작. 호출자는 이벤트 stream 을 listen.
  /// language: 'ko' → CLOVA Streaming, 'en' → OpenAI Realtime.
  Future<Result<Stream<CaptureEvent>>> start({required String language});

  /// 마이크/스트림 정지 + (옵션) 누적 WAV 업로드.
  Future<Result<void>> stop({bool uploadAudio = true});

  /// (옵션) 단일 발화의 화자 분류 use case 용 hook.
  Future<Speaker> classifySpeaker({
    required String text,
    required List<({Speaker speaker, String text})> history,
  });
}
