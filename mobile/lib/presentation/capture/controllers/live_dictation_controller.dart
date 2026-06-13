import 'dart:async';

import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../core/result/result.dart';
import '../../../data/repositories/analysis_repository_impl.dart';
import '../../../domain/entities/dictation.dart';
import '../../settings/controllers/dictation_template_controller.dart';
import '../../settings/controllers/settings_controller.dart';
import 'capture_controller.dart';

part 'live_dictation_controller.g.dart';

/// 받아쓰기 컨트롤러 — 현재 선택된 템플릿으로 dictate.
///
/// 템플릿 변경 시 utterance 가 쌓여 있다면 자동 재생성.
@riverpod
class LiveDictationController extends _$LiveDictationController {
  @override
  AsyncValue<Dictation?> build() {
    // 템플릿 변경 → 자동 재생성.
    ref.listen<DictationTemplate>(dictationTemplateControllerProvider, (
      prev,
      next,
    ) {
      if (prev != next &&
          ref.read(captureControllerProvider).utterances.isNotEmpty) {
        unawaited(regenerate());
      }
    });
    // stop → 자동 1회.
    ref.listen<CaptureState>(captureControllerProvider, (prev, next) {
      final prevLen = prev?.utterances.length ?? 0;
      // 전체 지우기 → 받아쓰기 초기화.
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
    // ignore: invalid_use_of_internal_member — 재생성 중 이전 작성문을 화면에 유지.
    state = const AsyncLoading<Dictation?>().copyWithPrevious(state);
    final lang = ref.read(settingsControllerProvider).language;
    final template = ref.read(dictationTemplateControllerProvider);
    final chunks = cap.utterances
        .map((c) => (speaker: c.speaker, text: c.text))
        .toList();
    final res = await ref
        .read(analysisRepositoryProvider)
        .dictate(language: lang, template: template, chunks: chunks);
    state = switch (res) {
      Success(value: final v) => AsyncValue<Dictation?>.data(v),
      FailureResult(failure: final f) => AsyncValue<Dictation?>.error(
        f,
        StackTrace.current,
      ),
    };
  }

  void updateLocal(Dictation next) {
    state = AsyncValue<Dictation?>.data(next);
  }
}
