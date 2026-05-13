import 'dart:async';

import 'package:riverpod_annotation/riverpod_annotation.dart';
import 'package:uuid/uuid.dart';

import '../../../core/error/failure.dart';
import '../../../core/result/result.dart';
import '../../../data/repositories/capture_repository_impl.dart';
import '../../../domain/entities/speaker.dart';
import '../../../domain/entities/transcript_chunk.dart';
import '../../../domain/repositories/capture_repository.dart';
import '../../settings/controllers/settings_controller.dart';

part 'capture_controller.g.dart';

class CaptureState {
  const CaptureState({
    required this.utterances,
    required this.partial,
    required this.active,
    this.error,
  });

  final List<TranscriptChunk> utterances;
  final String partial;
  final bool active;
  final Failure? error;

  CaptureState copyWith({
    List<TranscriptChunk>? utterances,
    String? partial,
    bool? active,
    Failure? error,
    bool clearError = false,
  }) =>
      CaptureState(
        utterances: utterances ?? this.utterances,
        partial: partial ?? this.partial,
        active: active ?? this.active,
        error: clearError ? null : (error ?? this.error),
      );

  factory CaptureState.initial() =>
      const CaptureState(utterances: [], partial: '', active: false);
}

@riverpod
class CaptureController extends _$CaptureController {
  static const _uuid = Uuid();
  StreamSubscription<CaptureEvent>? _sub;

  @override
  CaptureState build() {
    ref.onDispose(() {
      _sub?.cancel();
    });
    return CaptureState.initial();
  }

  Future<void> start() async {
    final lang = ref.read(settingsControllerProvider).language;
    final repo = ref.read(captureRepositoryProvider);
    final res = await repo.start(language: lang);
    switch (res) {
      case Success(value: final stream):
        _sub = stream.listen(_onEvent);
        state = state.copyWith(active: true, clearError: true);
      case FailureResult(failure: final f):
        state = state.copyWith(error: f);
    }
  }

  void _onEvent(CaptureEvent evt) {
    if (evt.isFinal) {
      final c = TranscriptChunk(
        id: _uuid.v4(),
        text: evt.text,
        timestampMs: DateTime.now().millisecondsSinceEpoch,
        speaker: Speaker.unknown,
      );
      state = state.copyWith(
        utterances: [...state.utterances, c],
        partial: '',
      );
    } else {
      state = state.copyWith(partial: evt.text);
    }
  }

  Future<void> stop() async {
    final repo = ref.read(captureRepositoryProvider);
    await _sub?.cancel();
    _sub = null;
    final res = await repo.stop();
    final failure = res is FailureResult ? res.failure : null;
    state = state.copyWith(
      active: false,
      partial: '',
      error: failure,
      clearError: failure == null,
    );
  }

  void clear() {
    state = CaptureState.initial();
  }
}
