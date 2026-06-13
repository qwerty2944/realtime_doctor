import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'package:shared_preferences/shared_preferences.dart';

part 'cloud_sync_controller.g.dart';

class CloudSyncState {
  const CloudSyncState({
    required this.enabled,
    required this.saveTranscripts,
    required this.saveAudio,
  });

  final bool enabled;
  final bool saveTranscripts;
  final bool saveAudio;

  CloudSyncState copyWith({
    bool? enabled,
    bool? saveTranscripts,
    bool? saveAudio,
  }) => CloudSyncState(
    enabled: enabled ?? this.enabled,
    saveTranscripts: saveTranscripts ?? this.saveTranscripts,
    saveAudio: saveAudio ?? this.saveAudio,
  );

  static const initial = CloudSyncState(
    enabled: true,
    saveTranscripts: true,
    saveAudio: false,
  );
}

const _kEnabled = 'cloudSync.enabled';
const _kSaveTranscripts = 'cloudSync.saveTranscripts';
const _kSaveAudio = 'cloudSync.saveAudio';

/// 클라우드 동기화 토글 (Enabled / Save transcripts / Save audio).
///
/// 실제 저장 로직은 향후 별도 단계. 여기서는 토글 상태만 SharedPreferences 에 보존.
@Riverpod(keepAlive: true)
class CloudSyncController extends _$CloudSyncController {
  @override
  CloudSyncState build() {
    Future.microtask(_load);
    return CloudSyncState.initial;
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    state = CloudSyncState(
      enabled: prefs.getBool(_kEnabled) ?? state.enabled,
      saveTranscripts:
          prefs.getBool(_kSaveTranscripts) ?? state.saveTranscripts,
      saveAudio: prefs.getBool(_kSaveAudio) ?? state.saveAudio,
    );
  }

  Future<void> setEnabled(bool v) async {
    if (v == state.enabled) return;
    state = state.copyWith(enabled: v);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kEnabled, v);
  }

  Future<void> setSaveTranscripts(bool v) async {
    if (v == state.saveTranscripts) return;
    state = state.copyWith(saveTranscripts: v);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kSaveTranscripts, v);
  }

  Future<void> setSaveAudio(bool v) async {
    if (v == state.saveAudio) return;
    state = state.copyWith(saveAudio: v);
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kSaveAudio, v);
  }
}
