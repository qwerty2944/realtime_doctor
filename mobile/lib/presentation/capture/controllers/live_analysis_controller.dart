import 'dart:async';

import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/result/result.dart';
import '../../../data/repositories/analysis_repository_impl.dart';
import '../../../domain/entities/analysis.dart';
import '../../settings/controllers/settings_controller.dart';
import 'capture_controller.dart';

part 'live_analysis_controller.g.dart';

/// 캡처 중 utterance 변화에 반응해 자동으로 Gemini 분석을 돌리는 컨트롤러.
///
/// Electron analyzer.ts 의 debounce 2.5s + 12s max-wait 동작과 동일.
@riverpod
class LiveAnalysisController extends _$LiveAnalysisController {
  static const _debounce = Duration(milliseconds: 2500);
  static const _maxWait = Duration(seconds: 12);

  Timer? _debounceTimer;
  DateTime? _firstQueuedAt;

  @override
  AsyncValue<Analysis?> build() {
    ref.listen<CaptureState>(captureControllerProvider, (prev, next) {
      final prevLen = prev?.utterances.length ?? 0;
      // 전체 지우기(발화가 비워짐) → 분석 결과도 초기화.
      if (next.utterances.isEmpty && prevLen > 0) {
        _debounceTimer?.cancel();
        _firstQueuedAt = null;
        state = const AsyncValue.data(null);
        return;
      }
      if (next.utterances.length > prevLen) {
        _schedule();
      }
    });
    ref.onDispose(() {
      _debounceTimer?.cancel();
    });
    return const AsyncValue.data(null);
  }

  void _schedule() {
    final now = DateTime.now();
    _firstQueuedAt ??= now;
    if (now.difference(_firstQueuedAt!) > _maxWait) {
      _debounceTimer?.cancel();
      unawaited(_run());
      return;
    }
    _debounceTimer?.cancel();
    _debounceTimer = Timer(_debounce, _run);
  }

  Future<void> _run() async {
    _firstQueuedAt = null;
    final cap = ref.read(captureControllerProvider);
    if (cap.utterances.isEmpty) return;
    final lang = ref.read(settingsControllerProvider).language;
    final chunks = cap.utterances
        .map((c) => (speaker: c.speaker, text: c.text))
        .toList();
    // ignore: invalid_use_of_internal_member — 재생성 중 이전 분석을 화면에 유지.
    state = const AsyncLoading<Analysis?>().copyWithPrevious(state);
    final res = await ref
        .read(analysisRepositoryProvider)
        .analyze(language: lang, chunks: chunks);
    state = switch (res) {
      Success(value: final v) => AsyncValue<Analysis?>.data(v),
      FailureResult(failure: final f) => AsyncValue<Analysis?>.error(
        f,
        StackTrace.current,
      ),
    };
  }

  /// 사용자 / stop 훅이 즉시 분석을 요구할 때.
  Future<void> regenerateNow() async {
    _debounceTimer?.cancel();
    await _run();
  }
}
