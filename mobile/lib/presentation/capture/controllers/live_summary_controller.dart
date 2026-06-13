import 'dart:async';

import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/result/result.dart';
import '../../../data/repositories/analysis_repository_impl.dart';
import '../../../domain/entities/summary.dart';
import '../../settings/controllers/settings_controller.dart';
import 'capture_controller.dart';

part 'live_summary_controller.g.dart';

/// 캡처 중/직후 Gemini summarizer 를 호출해 chart-note 를 만든다.
///
/// stop 훅에서 자동 1회 + 사용자 수동 재생성 + 인라인 편집 반영.
@riverpod
class LiveSummaryController extends _$LiveSummaryController {
  @override
  AsyncValue<Summary?> build() {
    // stop-and-analyze-all 훅: 녹음 active true → false 전환 시 자동 1회.
    ref.listen<CaptureState>(captureControllerProvider, (prev, next) {
      final prevLen = prev?.utterances.length ?? 0;
      // 전체 지우기 → 요약 초기화.
      if (next.utterances.isEmpty && prevLen > 0) {
        state = const AsyncValue.data(null);
        return;
      }
      final wasActive = prev?.active ?? false;
      if (wasActive && !next.active && next.utterances.isNotEmpty) {
        unawaited(regenerate());
      }
    });
    return const AsyncValue.data(null);
  }

  Future<void> regenerate() async {
    final cap = ref.read(captureControllerProvider);
    if (cap.utterances.isEmpty) return;
    // ignore: invalid_use_of_internal_member — 재생성 중 이전 요약을 화면에 유지.
    state = const AsyncLoading<Summary?>().copyWithPrevious(state);
    final lang = ref.read(settingsControllerProvider).language;
    final chunks = cap.utterances
        .map((c) => (speaker: c.speaker, text: c.text))
        .toList();
    final res = await ref
        .read(analysisRepositoryProvider)
        .summarize(language: lang, chunks: chunks);
    state = switch (res) {
      Success(value: final v) => AsyncValue<Summary?>.data(v),
      FailureResult(failure: final f) => AsyncValue<Summary?>.error(
        f,
        StackTrace.current,
      ),
    };
  }

  /// 인라인 편집 결과를 반영. 부모가 Summary 를 새로 만들어서 넘긴다.
  void updateLocal(Summary next) {
    state = AsyncValue<Summary?>.data(next);
  }
}
