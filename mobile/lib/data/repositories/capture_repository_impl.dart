import 'dart:async';
import 'dart:typed_data';

import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../core/error/failure.dart';
import '../../core/result/result.dart';
import '../../core/utils/logger.dart';
import '../../domain/entities/speaker.dart';
import '../../domain/repositories/capture_repository.dart';
import '../../infrastructure/audio/audio_recorder_provider.dart';
import '../../infrastructure/env/env.dart';
import '../datasources/remote/clova_stream_ws.dart';
import '../datasources/remote/openai_realtime_ws.dart';

part 'capture_repository_impl.g.dart';

class CaptureRepositoryImpl implements CaptureRepository {
  CaptureRepositoryImpl({
    required this.recorder,
    required this.env,
  });

  final AudioRecorderService recorder;
  final AppEnv env;

  ClovaStreamSession? _clova;
  OpenAiRealtimeSession? _openai;
  StreamSubscription<List<int>>? _audioSub;
  StreamController<CaptureEvent>? _out;

  @override
  Future<Result<Stream<CaptureEvent>>> start({required String language}) async {
    try {
      _out = StreamController<CaptureEvent>.broadcast();
      final pcm = await recorder.startStream();
      if (language == 'ko') {
        _clova = ClovaStreamSession(clovaSpeechSecret: env.clovaSpeechSecret);
        await _clova!.open();
        _clova!.events.listen((evt) {
          _out?.add(CaptureEvent(
            itemId: evt.itemId,
            text: evt.text,
            isFinal: evt.isFinal,
          ));
        });
        _audioSub = pcm.listen((bytes) {
          _clova!.sendAudio(Uint8List.fromList(bytes));
        });
      } else {
        _openai = OpenAiRealtimeSession(openaiApiKey: env.openaiApiKey);
        await _openai!.open();
        _openai!.events.listen((evt) {
          _out?.add(CaptureEvent(
            itemId: evt.itemId,
            text: evt.text,
            isFinal: evt.isFinal,
          ));
        });
        _audioSub = pcm.listen((bytes) {
          _openai!.sendAudio(Uint8List.fromList(bytes));
        });
      }
      return Success(_out!.stream);
    } catch (e, st) {
      appLogger.e('capture start failed', error: e, stackTrace: st);
      await _cleanup();
      return FailureResult(AudioFailure(e.toString()));
    }
  }

  @override
  Future<Result<void>> stop({bool uploadAudio = true}) async {
    try {
      await _cleanup();
      // TODO(audio-upload): record 패키지가 stream 모드에선 파일을 안 만들어
      // 누적 PCM 을 따로 받아 WAV 로 변환 + Supabase storage 업로드.
      return const Success(null);
    } catch (e) {
      return FailureResult(AudioFailure(e.toString()));
    }
  }

  Future<void> _cleanup() async {
    await _audioSub?.cancel();
    _audioSub = null;
    await recorder.stop();
    await _clova?.close();
    _clova = null;
    await _openai?.close();
    _openai = null;
    await _out?.close();
    _out = null;
  }

  @override
  Future<Speaker> classifySpeaker({
    required String text,
    required List<({Speaker speaker, String text})> history,
  }) async {
    // v1 stub — analyzer repository 가 Gemini diarizer 를 호출하는 경로로 옮길 수도 있음.
    return Speaker.unknown;
  }
}

@Riverpod(keepAlive: true)
CaptureRepository captureRepository(CaptureRepositoryRef ref) {
  return CaptureRepositoryImpl(
    recorder: ref.watch(audioRecorderProvider),
    env: ref.watch(envProvider),
  );
}
