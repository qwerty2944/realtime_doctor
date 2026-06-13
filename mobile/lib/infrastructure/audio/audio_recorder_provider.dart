import 'package:audio_session/audio_session.dart';
import 'package:flutter/services.dart' show PlatformException;
import 'package:record/record.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../core/constants/app_constants.dart';

part 'audio_recorder_provider.g.dart';

/// 마이크 PCM stream wrapping.
///
/// **권한은 호출자(CaptureController)가 보장한다.** 이 래퍼는 녹음만 책임.
/// 권한 처리는 `PermissionRepository` (clean architecture domain 인터페이스) 경유.
class AudioRecorderService {
  AudioRecorderService(this._recorder);
  final AudioRecorder _recorder;

  /// PCM16 stream — record 패키지의 raw PCM stream 모드.
  /// 호출 전에 마이크 권한이 granted 임을 보장해야 함.
  /// `sampleRate` 미지정 시 AppConstants 기본값(24kHz).
  /// 전사 provider 별로 요구하는 rate 가 달라 명시적 override 지원:
  ///   - CLOVA NEST: 16kHz
  ///   - OpenAI Realtime: 24kHz
  Future<Stream<List<int>>> startStream({int? sampleRate}) async {
    // iOS AVAudioSession 활성화는 audio_session 이 단독 담당한다 (main.dart 에서
    // playAndRecord 로 configure). record 가 직접 setCategory/setActive 하면
    // just_audio 가 잡고 있던 세션과 충돌해 "setActive: Session activation
    // failed" 로 녹음 시작이 실패한다. 샘플레이트는 record_darwin 이
    // AVAudioConverter 로 자체 변환하므로 세션 preferred rate 와 무관.
    final session = await AudioSession.instance;
    // 다른 오디오 세션(재생 등)이 우선순위를 쥐고 있으면 activation 이
    // InsufficientPriority(PlatformException, code 561017449='!pri')로 거부될 수
    // 있다. 한 번 양보(setActive false)시킨 뒤 재시도해 흡수한다. 두 번째도
    // 실패하면 그대로 전파 → CaptureController 가 실패로 처리.
    try {
      await session.setActive(true);
    } on PlatformException {
      await session.setActive(false);
      await Future<void>.delayed(const Duration(milliseconds: 250));
      await session.setActive(true);
    }
    final stream = await _recorder.startStream(
      RecordConfig(
        encoder: AudioEncoder.pcm16bits,
        sampleRate: sampleRate ?? AppConstants.audioSampleRate,
        numChannels: AppConstants.audioChannels,
        // record 5.x 에선 생성자 파라미터가 세션 관리를 끄는 유일한 방법.
        // ignore: deprecated_member_use
        iosConfig: const IosRecordConfig(manageAudioSession: false),
      ),
    );
    return stream;
  }

  Future<void> stop() async {
    await _recorder.stop();
    try {
      final session = await AudioSession.instance;
      await session.setActive(false);
    } catch (_) {
      // 세션 비활성화 실패는 치명적이지 않음 — 다음 활성화 시 복구된다.
    }
  }

  Future<bool> isRecording() => _recorder.isRecording();

  Future<void> dispose() async {
    await _recorder.dispose();
  }
}

@Riverpod(keepAlive: true)
AudioRecorderService audioRecorder(Ref ref) {
  final service = AudioRecorderService(AudioRecorder());
  ref.onDispose(() => service.dispose());
  return service;
}
