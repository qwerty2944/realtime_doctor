import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'package:uuid/uuid.dart';

import '../../core/error/failure.dart';
import '../../core/result/result.dart';
import '../../core/utils/logger.dart';
import '../../core/utils/wav.dart';
import '../../domain/entities/speaker.dart';
import '../../domain/repositories/capture_repository.dart';
import '../../infrastructure/audio/audio_recorder_provider.dart';
import '../../infrastructure/env/env.dart';
import '../../infrastructure/network/dio_provider.dart';
import '../datasources/remote/clova_nest_session.dart';
import '../datasources/remote/gemini_chunk_session.dart';
import '../datasources/remote/openai_realtime_ws.dart';
import '../datasources/remote/realtime_transcriber.dart';

part 'capture_repository_impl.g.dart';

class CaptureRepositoryImpl implements CaptureRepository {
  CaptureRepositoryImpl({
    required this.recorder,
    required this.env,
    required this.geminiDio,
  });

  final AudioRecorderService recorder;
  final AppEnv env;
  final Dio geminiDio;

  static const _uuid = Uuid();

  RealtimeTranscriber? _transcriber;
  StreamSubscription<List<int>>? _audioSub;
  StreamSubscription<TranscribeEvent>? _transcSub;
  StreamController<CaptureEvent>? _out;
  BytesBuilder? _allPcm;
  String? _sessionId;
  String? _language;
  String? _provider;
  DateTime? _startedAt;
  int _sampleRate = 24000;

  @override
  Future<Result<Stream<CaptureEvent>>> start({required String language}) async {
    try {
      _sessionId = _uuid.v4();
      _language = language;
      _startedAt = DateTime.now().toUtc();
      _allPcm = BytesBuilder();
      _out = StreamController<CaptureEvent>.broadcast();

      // 일렉트론과 동일한 라우팅:
      // - English → OpenAI Realtime WebSocket @ 24kHz (진짜 streaming)
      // - Korean  → CLOVA Speech NEST gRPC @ 16kHz (진짜 streaming, 일렉트론 동일)
      // - fallback → Gemini chunk (REST)
      if (language == 'en' && env.openaiApiKey.isNotEmpty) {
        _transcriber = OpenAiRealtimeSession(
          openaiApiKey: env.openaiApiKey,
          model: env.openaiTranscribeModel,
          language: language,
        );
        _provider = 'openai-realtime';
        _sampleRate = 24000;
      } else if (language == 'ko' && env.clovaSpeechSecret.isNotEmpty) {
        _sampleRate = 16000; // CLOVA NEST 표준 sample rate
        _transcriber = ClovaNestSession(
          secret: env.clovaSpeechSecret,
          sampleRate: _sampleRate,
          language: language,
        );
        _provider = 'clova-nest';
      } else {
        _transcriber = GeminiChunkSession(
          dio: geminiDio,
          apiKey: env.geminiApiKey,
          model: env.geminiTranscribeModel,
          language: language,
        );
        _provider = 'gemini-chunk';
        _sampleRate = 16000;
      }
      await _transcriber!.open();

      _transcSub = _transcriber!.events.listen((evt) {
        _out?.add(CaptureEvent(
          itemId: evt.itemId,
          text: evt.text,
          isFinal: evt.isFinal,
        ));
      }, onError: (Object err, StackTrace st) {
        appLogger.w('transcriber error: $err');
      });

      final pcm = await recorder.startStream(sampleRate: _sampleRate);
      _audioSub = pcm.listen((bytes) {
        final u8 = bytes is Uint8List ? bytes : Uint8List.fromList(bytes);
        _allPcm?.add(u8);
        _transcriber?.sendAudio(u8);
      });

      return Success(_out!.stream);
    } catch (e, st) {
      appLogger.e('capture start failed', error: e, stackTrace: st);
      await _cleanup();
      return FailureResult(AudioFailure(e.toString()));
    }
  }

  @override
  Future<Result<CaptureStopResult>> stop() async {
    try {
      final endedAt = DateTime.now().toUtc();
      final sessionId = _sessionId;
      final language = _language;
      final provider = _provider;
      final startedAt = _startedAt;
      final pcm = _allPcm?.toBytes();

      // recorder + transcriber 정리 (transcriber 의 close 가 남은 청크 flush).
      await _audioSub?.cancel();
      _audioSub = null;
      await recorder.stop();
      await _transcriber?.close();
      _transcriber = null;
      await _transcSub?.cancel();
      _transcSub = null;
      await _out?.close();
      _out = null;
      _allPcm = null;

      if (sessionId == null ||
          language == null ||
          provider == null ||
          startedAt == null) {
        return const FailureResult(AudioFailure('Capture not started.'));
      }

      Uint8List? wav;
      if (pcm != null && pcm.isNotEmpty) {
        wav = pcm16ToWav(pcm, sampleRate: _sampleRate);
      }

      return Success(CaptureStopResult(
        sessionId: sessionId,
        language: language,
        transcribeProvider: provider,
        startedAt: startedAt,
        endedAt: endedAt,
        audioWav: wav,
      ));
    } catch (e, st) {
      appLogger.e('capture stop failed', error: e, stackTrace: st);
      return FailureResult(AudioFailure(e.toString()));
    }
  }

  Future<void> _cleanup() async {
    await _audioSub?.cancel();
    _audioSub = null;
    try {
      await recorder.stop();
    } catch (_) {}
    await _transcriber?.close();
    _transcriber = null;
    await _transcSub?.cancel();
    _transcSub = null;
    await _out?.close();
    _out = null;
    _allPcm = null;
    _sessionId = null;
    _language = null;
    _provider = null;
    _startedAt = null;
  }

  @override
  Future<Speaker> classifySpeaker({
    required String text,
    required List<({Speaker speaker, String text})> history,
  }) async {
    // 화자 분류는 analysisRepository 의 diarizer 경로로 옮길 수 있음.
    return Speaker.unknown;
  }
}

@Riverpod(keepAlive: true)
CaptureRepository captureRepository(Ref ref) {
  return CaptureRepositoryImpl(
    recorder: ref.watch(audioRecorderProvider),
    env: ref.watch(envProvider),
    geminiDio: ref.watch(dioProvider),
  );
}
