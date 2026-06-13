import 'dart:async';

import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'package:uuid/uuid.dart';

import '../../../core/error/failure.dart';
import '../../../core/result/result.dart';
import '../../../core/utils/logger.dart';
import '../../../data/repositories/capture_repository_impl.dart';
import '../../../data/repositories/analysis_repository_impl.dart';
import '../../../data/repositories/sessions_repository_impl.dart';
import '../../../domain/entities/speaker.dart';
import '../../../domain/entities/transcript_chunk.dart';
import '../../../domain/repositories/capture_repository.dart';
import '../../../domain/repositories/permission_repository.dart';
import '../../../infrastructure/permission/permission_repository_impl.dart';
import '../../sessions/controllers/sessions_list_controller.dart';
import '../../settings/controllers/cloud_sync_controller.dart';
import '../../settings/controllers/settings_controller.dart';

part 'capture_controller.g.dart';

class CaptureState {
  const CaptureState({
    required this.utterances,
    required this.partial,
    required this.active,
    this.error,
    this.fallbackReason,
    this.saving = false,
    this.savedSessionId,
  });

  final List<TranscriptChunk> utterances;
  final String partial;
  final bool active;
  final Failure? error;

  /// 전사가 스트림→청크로 fallback 됐을 때 노란 배너 표시용.
  final String? fallbackReason;

  /// stop 직후 Supabase 저장이 진행 중인지 여부.
  final bool saving;

  /// 마지막으로 저장 성공한 세션 id. 저장 직후 "기록에서 확인" 같은 UX 에 쓰임.
  final String? savedSessionId;

  CaptureState copyWith({
    List<TranscriptChunk>? utterances,
    String? partial,
    bool? active,
    Failure? error,
    String? fallbackReason,
    bool? saving,
    String? savedSessionId,
    bool clearError = false,
    bool clearFallback = false,
    bool clearSaved = false,
  }) => CaptureState(
    utterances: utterances ?? this.utterances,
    partial: partial ?? this.partial,
    active: active ?? this.active,
    error: clearError ? null : (error ?? this.error),
    fallbackReason: clearFallback
        ? null
        : (fallbackReason ?? this.fallbackReason),
    saving: saving ?? this.saving,
    savedSessionId: clearSaved ? null : (savedSessionId ?? this.savedSessionId),
  );

  factory CaptureState.initial() =>
      const CaptureState(utterances: [], partial: '', active: false);
}

@riverpod
class CaptureController extends _$CaptureController {
  static const _uuid = Uuid();
  StreamSubscription<CaptureEvent>? _sub;

  /// 무음 자동 확정 타이머 — 전사기가 final 을 늦게/안 주는 경우, partial 갱신이
  /// 일정 시간 멈추면(말이 끝났다고 보고) partial 을 발화로 자동 확정한다.
  Timer? _silenceTimer;
  static const _silenceCommit = Duration(seconds: 3);

  /// itemId → 기존 utterance index. partial 업데이트 시 같은 chunk 갱신용.
  final Map<String, int> _itemIndex = {};

  /// 논리 캡처 세션 id — 정지→재개를 반복해도 유지되고, clear() 에서만 리셋된다.
  /// 같은 진료를 이어 녹음하면 같은 세션으로 Supabase 에 누적 저장된다.
  String? _sessionId;

  /// 첫 시작 시각(세션 started_at 고정용) — 재개 시에도 원래 시각 유지.
  DateTime? _startedAt;

  /// 이미 Supabase 에 저장된 발화 수. 다음 저장 땐 이 인덱스 이후만 추가 insert.
  int _savedCount = 0;

  /// 마지막 캡처의 전사 provider(저장 메타용). 수동 저장 시 재사용.
  String? _provider;

  @override
  CaptureState build() {
    ref.onDispose(() {
      _sub?.cancel();
      _silenceTimer?.cancel();
    });
    return CaptureState.initial();
  }

  Future<void> start() async {
    // 1) 마이크 권한 게이트. 영구거부면 다이얼로그 없이 즉시 실패 → UI 가 "설정 열기"
    //    버튼을 띄울 수 있게 한다.
    final perm = ref.read(permissionRepositoryProvider);
    var status = await perm.microphoneStatus();
    if (status == MicrophonePermission.denied) {
      status = await perm.requestMicrophone();
    }
    if (status != MicrophonePermission.granted) {
      state = state.copyWith(
        error:
            status == MicrophonePermission.permanentlyDenied ||
                status == MicrophonePermission.restricted
            ? const MicrophonePermanentlyDeniedFailure('mic permanently denied')
            : const MicrophoneDeniedFailure('mic denied'),
      );
      return;
    }

    // 2) 권한 OK → 전사 + 녹음 시작.
    final lang = ref.read(settingsControllerProvider).language;
    final repo = ref.read(captureRepositoryProvider);
    _itemIndex.clear();
    final res = await repo.start(language: lang);
    switch (res) {
      case Success(value: final stream):
        _sub = stream.listen(_onEvent);
        // 이어서 녹음 — 기존 발화는 유지하고 partial/에러/폴백만 정리한다.
        // 전체 초기화는 clear() 로만(설정/버튼).
        state = state.copyWith(
          active: true,
          partial: '',
          clearError: true,
          clearFallback: true,
        );
      case FailureResult(failure: final f):
        state = state.copyWith(error: f);
    }
  }

  /// 영구거부 상태에서 사용자가 "설정 열기" 눌렀을 때.
  Future<bool> openMicSettings() =>
      ref.read(permissionRepositoryProvider).openAppSettings();

  void _onEvent(CaptureEvent evt) {
    if (evt.isFinal) {
      // 전사기가 발화 종료를 알려옴 → 즉시 확정.
      _silenceTimer?.cancel();
      _appendFinal(evt.text);
    } else {
      // 진행 중 partial. 새 발화가 시작되면(이전 partial 과 이어지지 않으면)
      // 이전 걸 먼저 확정해 위 목록으로 올리고, 새 partial 을 시작한다.
      // → 앞 발화가 다음 발화에 씹히지 않는다.
      final prev = state.partial;
      if (prev.isNotEmpty && !_continues(prev, evt.text)) {
        _appendFinal(prev);
      }
      state = state.copyWith(partial: evt.text);
      _silenceTimer?.cancel();
      _silenceTimer = Timer(_silenceCommit, commitPartial);
    }
  }

  /// 두 partial 이 같은 발화의 연속인지 — 누적 성장(접두 일치)이거나 충분히 긴
  /// 공통 접두사를 가지면 연속, 아니면 새 발화로 본다.
  bool _continues(String prev, String next) {
    if (next.startsWith(prev) || prev.startsWith(next)) return true;
    final n = prev.length < next.length ? prev.length : next.length;
    var common = 0;
    while (common < n && prev[common] == next[common]) {
      common++;
    }
    return common >= 3;
  }

  /// 발화 텍스트를 목록에 추가. 직전 발화와 동일하면 중복으로 보고 무시
  /// (무음 타이머가 확정한 뒤 늦은 final 이 또 들어오는 경우 방지).
  void _appendFinal(String text) {
    final trimmed = text.trim();
    if (trimmed.isEmpty) {
      if (state.partial.isNotEmpty) state = state.copyWith(partial: '');
      return;
    }
    // 최근 발화 몇 개와 동일하면 중복(경계 확정 뒤 늦게 온 final 등) → 무시.
    // 이렇게 해야 순서가 뒤바뀌거나 같은 발화가 두 번 올라가지 않는다.
    final n = state.utterances.length;
    final recent = n > 3 ? state.utterances.sublist(n - 3) : state.utterances;
    if (recent.any((c) => c.text == trimmed)) {
      if (state.partial.isNotEmpty) state = state.copyWith(partial: '');
      return;
    }
    final c = TranscriptChunk(
      id: _uuid.v4(),
      text: trimmed,
      timestampMs: DateTime.now().millisecondsSinceEpoch,
      speaker: Speaker.unknown,
    );
    state = state.copyWith(utterances: [...state.utterances, c], partial: '');
  }

  Future<void> stop() async {
    final repo = ref.read(captureRepositoryProvider);
    _silenceTimer?.cancel();
    await _sub?.cancel();
    _sub = null;
    final res = await repo.stop();

    switch (res) {
      case Success(value: final stopResult):
        // 진행 중이던 partial 을 마지막 발화로 확정(유실 방지).
        commitPartial();
        // 화자 자동 분류 — ?(미상)로 남은 발화에 의사/환자 라벨을 채운다.
        await autoLabelSpeakers();
        // 논리 세션 id·시작 시각·provider 를 최초 1회 확정하고 이후 재사용.
        _sessionId ??= stopResult.sessionId;
        _startedAt ??= stopResult.startedAt;
        _provider ??= stopResult.transcribeProvider;
        // 1) 일단 active=false 로 UI 갱신 + saving 시작.
        state = state.copyWith(
          active: false,
          partial: '',
          saving: state.utterances.isNotEmpty,
          clearError: true,
        );
        // 2) 발화가 있다면 Supabase 에 저장. 이번에 새로 추가된 발화만 insert.
        if (state.utterances.isNotEmpty) {
          final cloudSync = ref.read(cloudSyncControllerProvider);
          if (cloudSync.enabled && cloudSync.saveTranscripts) {
            final newChunks = state.utterances.length > _savedCount
                ? state.utterances.sublist(_savedCount)
                : const <TranscriptChunk>[];
            final persist = await ref
                .read(sessionsRepositoryProvider)
                .persistCapture(
                  sessionId: _sessionId!,
                  startedAt: _startedAt!,
                  stopResult: stopResult,
                  chunks: newChunks,
                  uploadAudio: cloudSync.saveAudio,
                );
            switch (persist) {
              case Success():
                _savedCount = state.utterances.length;
                state = state.copyWith(
                  saving: false,
                  savedSessionId: _sessionId,
                );
                // 세션 리스트 새로고침 → 방금 저장한 세션이 즉시 보이도록.
                ref.invalidate(sessionsListControllerProvider);
              case FailureResult(failure: final f):
                appLogger.w('persistCapture failed: ${f.message}');
                state = state.copyWith(saving: false, error: f);
            }
          } else {
            state = state.copyWith(saving: false);
          }
        }
      case FailureResult(failure: final f):
        state = state.copyWith(
          active: false,
          partial: '',
          saving: false,
          error: f,
        );
    }
  }

  /// 개별 발화 삭제 — 목록에서 제거하고, 이미 저장된 발화면 Supabase 에서도 삭제.
  void removeUtterance(String chunkId) {
    final idx = state.utterances.indexWhere((c) => c.id == chunkId);
    if (idx < 0) return;
    final wasSaved = idx < _savedCount;
    final updated = [...state.utterances]..removeAt(idx);
    if (wasSaved) {
      _savedCount -= 1;
      unawaited(ref.read(sessionsRepositoryProvider).deleteChunk(chunkId));
    }
    state = state.copyWith(utterances: updated);
  }

  /// 화자 자동 분류 — 현재 발화들을 Gemini 로 의사/환자 라벨링. 수동으로 이미
  /// 지정한(미상이 아닌) 발화는 보존하고 ?(미상)만 채운다. 실패는 무시.
  Future<void> autoLabelSpeakers() async {
    if (state.utterances.isEmpty) return;
    final lang = ref.read(settingsControllerProvider).language;
    final texts = [for (final c in state.utterances) c.text];
    final res = await ref
        .read(analysisRepositoryProvider)
        .diarize(language: lang, texts: texts);
    if (res is! Success<List<Speaker>>) return;
    final labels = res.value;
    final updated = <TranscriptChunk>[
      for (var i = 0; i < state.utterances.length; i++)
        (state.utterances[i].speaker == Speaker.unknown &&
                i < labels.length &&
                labels[i] != Speaker.unknown)
            ? state.utterances[i].copyWith(speaker: labels[i])
            : state.utterances[i],
    ];
    state = state.copyWith(utterances: updated);
  }

  /// 의사 ↔ 환자 일괄 반전. unknown 은 그대로.
  void swapSpeakers() {
    final swapped = [
      for (final c in state.utterances)
        c.copyWith(
          speaker: switch (c.speaker) {
            Speaker.doctor => Speaker.patient,
            Speaker.patient => Speaker.doctor,
            Speaker.unknown => Speaker.unknown,
          },
        ),
    ];
    state = state.copyWith(utterances: swapped);
  }

  /// 단일 청크 화자 재라벨.
  void relabel(String chunkId, Speaker next) {
    final updated = [
      for (final c in state.utterances)
        if (c.id == chunkId) c.copyWith(speaker: next) else c,
    ];
    state = state.copyWith(utterances: updated);
  }

  void clearFallback() {
    if (state.fallbackReason == null) return;
    state = state.copyWith(clearFallback: true);
  }

  /// 진행 중이던 partial 텍스트를 발화로 확정한다(무음 타이머 / 정지 훅).
  void commitPartial() {
    _silenceTimer?.cancel();
    _appendFinal(state.partial);
  }

  /// 현재 누적 발화를 즉시 Supabase 에 저장(수동 "저장" 버튼). 정지하지 않아도 됨.
  /// 이미 저장된 발화 이후만 추가 insert 하고 세션 row 는 upsert 된다.
  Future<void> saveNow() async {
    commitPartial();
    if (state.utterances.isEmpty) return;
    _sessionId ??= _uuid.v4();
    _startedAt ??= DateTime.now().toUtc();
    final lang = ref.read(settingsControllerProvider).language;
    state = state.copyWith(saving: true, clearError: true);
    final newChunks = state.utterances.length > _savedCount
        ? state.utterances.sublist(_savedCount)
        : const <TranscriptChunk>[];
    final stopResult = CaptureStopResult(
      sessionId: _sessionId!,
      language: lang,
      transcribeProvider: _provider ?? 'manual',
      startedAt: _startedAt!,
      endedAt: DateTime.now().toUtc(),
    );
    final persist = await ref
        .read(sessionsRepositoryProvider)
        .persistCapture(
          sessionId: _sessionId!,
          startedAt: _startedAt!,
          stopResult: stopResult,
          chunks: newChunks,
          uploadAudio: false,
        );
    switch (persist) {
      case Success():
        _savedCount = state.utterances.length;
        state = state.copyWith(saving: false, savedSessionId: _sessionId);
        ref.invalidate(sessionsListControllerProvider);
      case FailureResult(failure: final f):
        state = state.copyWith(saving: false, error: f);
    }
  }

  /// 저장된 세션을 캡처 화면으로 불러와 이어서 작업한다(수동 "불러오기").
  /// 불러온 발화는 이미 저장된 것으로 간주(중복 저장 방지).
  void loadSession({
    required String sessionId,
    required List<TranscriptChunk> chunks,
    required DateTime startedAt,
  }) {
    _silenceTimer?.cancel();
    _itemIndex.clear();
    _sessionId = sessionId;
    _startedAt = startedAt;
    _savedCount = chunks.length;
    _provider = null;
    state = CaptureState(
      utterances: chunks,
      partial: '',
      active: false,
      savedSessionId: sessionId,
    );
  }

  /// 전체 초기화 — 현재 누적 발화/세션을 비우고 완전히 새 캡처로 시작.
  /// (이미 Supabase 에 저장된 세션은 그대로 남는다.)
  void clear() {
    _silenceTimer?.cancel();
    _itemIndex.clear();
    _sessionId = null;
    _startedAt = null;
    _provider = null;
    _savedCount = 0;
    state = CaptureState.initial();
  }
}
