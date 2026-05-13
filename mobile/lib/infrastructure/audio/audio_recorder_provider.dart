import 'package:permission_handler/permission_handler.dart';
import 'package:record/record.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../core/constants/app_constants.dart';
import '../../core/error/exceptions.dart';

part 'audio_recorder_provider.g.dart';

/// 마이크 권한 + 16kHz PCM stream wrapping.
class AudioRecorderService {
  AudioRecorderService(this._recorder);
  final AudioRecorder _recorder;

  Future<bool> ensurePermission() async {
    final status = await Permission.microphone.request();
    return status.isGranted;
  }

  /// PCM16 stream — record 패키지가 raw PCM stream 모드 지원.
  Future<Stream<List<int>>> startStream() async {
    if (!await ensurePermission()) {
      throw const AudioException('마이크 권한이 거부되었습니다.');
    }
    final stream = await _recorder.startStream(
      RecordConfig(
        encoder: AudioEncoder.pcm16bits,
        sampleRate: AppConstants.audioSampleRate,
        numChannels: AppConstants.audioChannels,
      ),
    );
    return stream;
  }

  Future<void> stop() async {
    await _recorder.stop();
  }

  Future<bool> isRecording() => _recorder.isRecording();

  Future<void> dispose() async {
    await _recorder.dispose();
  }
}

@Riverpod(keepAlive: true)
AudioRecorderService audioRecorder(AudioRecorderRef ref) {
  final service = AudioRecorderService(AudioRecorder());
  ref.onDispose(() => service.dispose());
  return service;
}
