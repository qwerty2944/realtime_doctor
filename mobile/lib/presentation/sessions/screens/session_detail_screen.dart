import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:just_audio/just_audio.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/result/result.dart';
import '../../../core/utils/date_format.dart';
import '../../../core/utils/layout.dart';
import '../../../data/repositories/analysis_repository_impl.dart';
import '../../../data/repositories/sessions_repository_impl.dart';
import '../../../domain/entities/analysis.dart';
import '../../../domain/entities/dictation.dart';
import '../../../domain/entities/summary.dart';
import '../../../domain/entities/transcript_chunk.dart';
import '../../../generated/l10n/app_localizations.dart';
import '../../../infrastructure/audio/audio_player_provider.dart';
import '../../common/analyzing_indicator.dart';
import '../../common/error_view.dart';
import '../../common/generate_button.dart';
import '../../common/loading_view.dart';
import '../../common/pill_tab_bar.dart';
import '../../settings/controllers/dictation_template_controller.dart';
import '../../settings/controllers/settings_controller.dart';
import '../controllers/session_detail_controller.dart';
import '../widgets/diagnosis_view.dart';
import '../widgets/dictation_view.dart';
import '../widgets/questions_view.dart';
import '../widgets/summary_view.dart';
import '../widgets/terms_view.dart';
import '../widgets/transcript_view.dart';

class SessionDetailScreen extends ConsumerStatefulWidget {
  const SessionDetailScreen({required this.id, super.key});
  final String id;

  @override
  ConsumerState<SessionDetailScreen> createState() =>
      _SessionDetailScreenState();
}

class _SessionDetailScreenState extends ConsumerState<SessionDetailScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;

  // 인라인 편집/재생성으로 생긴 메모리 한정 override.
  // 화면을 나갔다 들어오면 사라짐(영속화는 별도 단계).
  Analysis? _analysisOverride;
  Summary? _summaryOverride;
  Dictation? _dictationOverride;
  bool _busyAnalysis = false;
  bool _busySummary = false;
  bool _busyDictation = false;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 6, vsync: this);
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  /// 분석/요약/받아쓰기 편집·재생성 결과를 Supabase 에 저장.
  Future<void> _save() async {
    final d = ref.read(sessionDetailControllerProvider(widget.id)).value;
    if (d == null) return;
    final repo = ref.read(sessionsRepositoryProvider);
    final a = _analysisOverride ?? d.analysis;
    final s = _summaryOverride ?? d.summary;
    final di = _dictationOverride ?? d.dictation;
    setState(() => _saving = true);
    if (a != null) await repo.persistAnalysis(sessionId: widget.id, analysis: a);
    if (s != null) await repo.persistSummary(sessionId: widget.id, summary: s);
    if (di != null) {
      await repo.persistDictation(sessionId: widget.id, dictation: di);
    }
    if (!mounted) return;
    setState(() => _saving = false);
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(content: Text(AppLocalizations.of(context).captureSaved)),
      );
  }

  Future<void> _regenerateAnalysis(List<TranscriptChunk> chunks) async {
    if (chunks.isEmpty) return;
    setState(() => _busyAnalysis = true);
    final lang = ref.read(settingsControllerProvider).language;
    final mapped = chunks
        .map((c) => (speaker: c.speaker, text: c.text))
        .toList();
    final res = await ref
        .read(analysisRepositoryProvider)
        .analyze(language: lang, chunks: mapped);
    if (!mounted) return;
    setState(() {
      _busyAnalysis = false;
      switch (res) {
        case Success(value: final v):
          _analysisOverride = v;
        case FailureResult():
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(res.failure.message)));
      }
    });
  }

  Future<void> _regenerateSummary(List<TranscriptChunk> chunks) async {
    if (chunks.isEmpty) return;
    setState(() => _busySummary = true);
    final lang = ref.read(settingsControllerProvider).language;
    final mapped = chunks
        .map((c) => (speaker: c.speaker, text: c.text))
        .toList();
    final res = await ref
        .read(analysisRepositoryProvider)
        .summarize(language: lang, chunks: mapped);
    if (!mounted) return;
    setState(() {
      _busySummary = false;
      switch (res) {
        case Success(value: final v):
          _summaryOverride = v;
        case FailureResult():
          // 실패시 기존 값 유지 — 별도 SnackBar 알림.
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(res.failure.message)));
      }
    });
  }

  Future<void> _regenerateDictation(List<TranscriptChunk> chunks) async {
    if (chunks.isEmpty) return;
    setState(() => _busyDictation = true);
    final lang = ref.read(settingsControllerProvider).language;
    final template = ref.read(dictationTemplateControllerProvider);
    final mapped = chunks
        .map((c) => (speaker: c.speaker, text: c.text))
        .toList();
    final res = await ref
        .read(analysisRepositoryProvider)
        .dictate(language: lang, template: template, chunks: mapped);
    if (!mounted) return;
    setState(() {
      _busyDictation = false;
      switch (res) {
        case Success(value: final v):
          _dictationOverride = v;
        case FailureResult():
          ScaffoldMessenger.of(
            context,
          ).showSnackBar(SnackBar(content: Text(res.failure.message)));
      }
    });
  }

  /// 분석 계열 탭(감별진단/의학용어/추천질문) 공용 래퍼 — 상단 "분석" 버튼 +
  /// 로딩 인디케이터. 불러온 세션에서도 분석을 다시 돌릴 수 있다.
  Widget _wrapAnalyze(
    List<TranscriptChunk> chunks,
    Analysis? analysis,
    Widget child,
  ) {
    return Column(
      children: [
        Padding(
          padding: EdgeInsets.fromLTRB(
            AppSpacing.md.w,
            AppSpacing.sm.h,
            AppSpacing.md.w,
            0,
          ),
          child: Align(
            alignment: Alignment.centerRight,
            child: GenerateButton(
              busy: _busyAnalysis,
              onPressed: chunks.isEmpty
                  ? null
                  : () => _regenerateAnalysis(chunks),
            ),
          ),
        ),
        Expanded(
          child: _busyAnalysis && analysis == null
              ? const AnalyzingIndicator()
              : child,
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final state = ref.watch(sessionDetailControllerProvider(widget.id));

    // 템플릿 변경 시 자동 재생성.
    ref.listen<DictationTemplate>(dictationTemplateControllerProvider, (
      prev,
      next,
    ) {
      if (prev != next) {
        final s = state.value;
        if (s != null && s.chunks.isNotEmpty) {
          unawaited(_regenerateDictation(s.chunks));
        }
      }
    });

    return Scaffold(
      appBar: AppBar(
        title: state.when(
          data: (d) => Text(
            d.session.title?.isNotEmpty == true
                ? d.session.title!
                : formatSessionStart(d.session.startedAt),
          ),
          loading: () => Text(t.sessionDetailTitle),
          error: (_, __) => Text(t.sessionDetailTitle),
        ),
        actions: [
          // 분석/요약/받아쓰기 변경사항 저장.
          IconButton(
            tooltip: t.captureSave,
            onPressed: _saving || !state.hasValue ? null : _save,
            icon: _saving
                ? SizedBox(
                    width: 18.r,
                    height: 18.r,
                    child: const CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(LucideIcons.save),
          ),
        ],
      ),
      body: Column(
        children: [
          // 슬라이딩 pill 탭 — 연결된 트랙 안에서 인디케이터가 미끄러진다.
          Padding(
            padding: EdgeInsets.symmetric(vertical: AppSpacing.sm.h),
            child: PillTabBar(
              controller: _tabs,
              labels: [
                t.tabTranscript,
                t.tabDiagnosis,
                t.tabTerms,
                t.tabQuestions,
                t.tabSummary,
                t.tabDictation,
              ],
            ),
          ),
          Expanded(
            child: state.when(
              loading: () => const LoadingView(),
              error: (e, _) => ErrorView(
                message: e.toString(),
                onRetry: () =>
                    ref.invalidate(sessionDetailControllerProvider(widget.id)),
              ),
              data: (d) {
                final analysis = _analysisOverride ?? d.analysis;
                final summary = _summaryOverride ?? d.summary;
                final dictation = _dictationOverride ?? d.dictation;
                return TabBarView(
                  controller: _tabs,
                  children: [
                    _SyncedTranscript(
                      chunks: d.chunks,
                      startedAt: d.session.startedAt,
                      signedUrl: d.signedAudioUrl,
                    ),
                    _wrapAnalyze(
                      d.chunks,
                      analysis,
                      DiagnosisView(analysis: analysis),
                    ),
                    _wrapAnalyze(
                      d.chunks,
                      analysis,
                      TermsView(analysis: analysis),
                    ),
                    _wrapAnalyze(
                      d.chunks,
                      analysis,
                      QuestionsView(analysis: analysis),
                    ),
                    SummaryView(
                      summary: summary,
                      busy: _busySummary,
                      onChanged: (next) =>
                          setState(() => _summaryOverride = next),
                      onRegenerate: d.chunks.isEmpty
                          ? null
                          : () => _regenerateSummary(d.chunks),
                    ),
                    DictationView(
                      dictation: dictation,
                      busy: _busyDictation,
                      onChanged: (next) =>
                          setState(() => _dictationOverride = next),
                      onRegenerate: d.chunks.isEmpty
                          ? null
                          : () => _regenerateDictation(d.chunks),
                    ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// 오디오 재생 위치와 동기화되는 전사 + 하단 재생바.
/// 재생 중 현재 발화 상자를 강조하고 그 발화로 자동 스크롤한다.
/// 발화 offset = chunk.timestampMs - 세션 시작.
class _SyncedTranscript extends ConsumerStatefulWidget {
  const _SyncedTranscript({
    required this.chunks,
    required this.startedAt,
    required this.signedUrl,
  });

  final List<TranscriptChunk> chunks;
  final DateTime startedAt;
  final String? signedUrl;

  @override
  ConsumerState<_SyncedTranscript> createState() => _SyncedTranscriptState();
}

class _SyncedTranscriptState extends ConsumerState<_SyncedTranscript> {
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (widget.signedUrl == null) return;
    try {
      await ref.read(audioPlayerProvider).setUrl(widget.signedUrl!);
      if (mounted) setState(() => _loaded = true);
    } catch (_) {
      // 무시 — 오디오 없이 전사만.
    }
  }

  @override
  void dispose() {
    // 화면을 떠나면 재생 정지.
    ref.read(audioPlayerProvider).pause();
    super.dispose();
  }

  String? _activeId(int posMs) {
    final startMs = widget.startedAt.millisecondsSinceEpoch;
    for (final c in widget.chunks) {
      if (c.timestampMs - startMs >= posMs) return c.id;
    }
    return widget.chunks.isEmpty ? null : widget.chunks.last.id;
  }

  @override
  Widget build(BuildContext context) {
    final player = ref.read(audioPlayerProvider);
    final hasAudio = widget.signedUrl != null;
    return Column(
      children: [
        Expanded(
          child: StreamBuilder<bool>(
            stream: player.playingStream,
            builder: (_, playSnap) {
              final playing = playSnap.data ?? false;
              return StreamBuilder<Duration>(
                stream: player.positionStream,
                builder: (_, posSnap) {
                  final activeId = playing
                      ? _activeId(
                          (posSnap.data ?? Duration.zero).inMilliseconds,
                        )
                      : null;
                  return TranscriptView(
                    chunks: widget.chunks,
                    bottomInset: hasAudio ? 0 : context.glassNavBarInset,
                    activeChunkId: activeId,
                  );
                },
              );
            },
          ),
        ),
        if (hasAudio) _AudioBar(player: player, loaded: _loaded),
      ],
    );
  }
}

/// 전사 하단 컴팩트 재생바 — 재생/일시정지 + 게이지 + 시간.
class _AudioBar extends StatelessWidget {
  const _AudioBar({required this.player, required this.loaded});

  final AudioPlayer player;
  final bool loaded;

  String _fmt(Duration d) {
    final m = d.inMinutes.remainder(60).toString().padLeft(2, '0');
    final s = d.inSeconds.remainder(60).toString().padLeft(2, '0');
    return '${d.inHours > 0 ? '${d.inHours}:' : ''}$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    final cs = context.colors;
    return Container(
      decoration: BoxDecoration(
        color: cs.surfaceContainerHigh,
        border: Border(
          top: BorderSide(color: cs.outlineVariant.withValues(alpha: 0.5)),
        ),
      ),
      // 글래스 탭바 위로 확실히 올린다(캡처 화면과 동일 방식: SafeArea + 바 높이).
      padding: EdgeInsets.fromLTRB(
        AppSpacing.md.w,
        AppSpacing.sm.h,
        AppSpacing.md.w,
        AppSpacing.sm.h + GlassNavBarLayout.navBarHeight,
      ),
      child: SafeArea(
        top: false,
        child: StreamBuilder<Duration?>(
        stream: player.durationStream,
        builder: (_, durSnap) {
          final dur = durSnap.data ?? Duration.zero;
          return StreamBuilder<Duration>(
            stream: player.positionStream,
            builder: (_, posSnap) {
              final pos = posSnap.data ?? Duration.zero;
              return Row(
                children: [
                  StreamBuilder<PlayerState>(
                    stream: player.playerStateStream,
                    builder: (_, snap) {
                      final playing = snap.data?.playing ?? false;
                      return IconButton.filled(
                        iconSize: 24.r,
                        onPressed: !loaded
                            ? null
                            : () => playing ? player.pause() : player.play(),
                        icon: Icon(
                          playing
                              ? Icons.pause_rounded
                              : Icons.play_arrow_rounded,
                        ),
                      );
                    },
                  ),
                  Expanded(
                    child: Slider(
                      max: dur.inMilliseconds.toDouble().clamp(
                        1,
                        double.infinity,
                      ),
                      value: pos.inMilliseconds.toDouble().clamp(
                        0,
                        dur.inMilliseconds.toDouble(),
                      ),
                      onChanged: !loaded
                          ? null
                          : (v) =>
                              player.seek(Duration(milliseconds: v.toInt())),
                    ),
                  ),
                  Text('${_fmt(pos)} / ${_fmt(dur)}', style: context.monoTime),
                ],
              );
            },
          );
        },
      ),
      ),
    );
  }
}
