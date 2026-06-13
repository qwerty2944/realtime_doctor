import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../core/error/failure.dart';
import '../../../core/result/result.dart';
import '../../../core/utils/date_format.dart';
import '../../../core/utils/layout.dart';
import '../../../data/repositories/sessions_repository_impl.dart';
import '../../../domain/entities/analysis.dart';
import '../../../domain/entities/session.dart';
import '../../../generated/l10n/app_localizations.dart';
import '../../common/action_banner.dart';
import '../../common/analyzing_indicator.dart';
import '../../common/confirm_dialog.dart';
import '../../common/empty_view.dart';
import '../../common/fallback_banner.dart';
import '../../common/pill_tab_bar.dart';
import '../../sessions/controllers/sessions_list_controller.dart';
import '../widgets/record_button.dart';
import '../../sessions/widgets/diagnosis_view.dart';
import '../../sessions/widgets/dictation_view.dart';
import '../../sessions/widgets/questions_view.dart';
import '../../sessions/widgets/summary_view.dart';
import '../../sessions/widgets/terms_view.dart';
import '../../sessions/widgets/transcript_view.dart';
import '../controllers/capture_controller.dart';
import '../controllers/live_analysis_controller.dart';
import '../controllers/live_dictation_controller.dart';
import '../controllers/live_summary_controller.dart';

/// 실시간 캡처 화면.
///
/// 일렉트론 desktop 의 7개 윈도우(Transcript/Diagnosis/Terms/Questions/Summary/
/// Dictation) 중 Audio 를 뺀 6개를 탭으로 구성. Audio 는 캡처 도중 의미 없음.
class CaptureScreen extends ConsumerStatefulWidget {
  const CaptureScreen({super.key});

  @override
  ConsumerState<CaptureScreen> createState() => _CaptureScreenState();
}

class _CaptureScreenState extends ConsumerState<CaptureScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;

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

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final st = ref.watch(captureControllerProvider);
    final ctrl = ref.read(captureControllerProvider.notifier);

    final analysisState = ref.watch(liveAnalysisControllerProvider);
    final summaryState = ref.watch(liveSummaryControllerProvider);
    final dictationState = ref.watch(liveDictationControllerProvider);

    final hasUtterances = st.utterances.isNotEmpty;
    void analyze() =>
        ref.read(liveAnalysisControllerProvider.notifier).regenerateNow();

    return Scaffold(
      appBar: AppBar(title: Text(t.captureTitle)),
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
          if (st.error != null)
            Padding(
              padding: EdgeInsets.fromLTRB(
                AppSpacing.md.w,
                AppSpacing.sm.h,
                AppSpacing.md.w,
                0,
              ),
              child: _ErrorBanner(
                error: st.error!,
                onRetry: () => ctrl.start(),
                onOpenSettings: () => ctrl.openMicSettings(),
              ),
            ),
          if (st.fallbackReason != null)
            Padding(
              padding: EdgeInsets.fromLTRB(
                AppSpacing.md.w,
                AppSpacing.sm.h,
                AppSpacing.md.w,
                0,
              ),
              child: FallbackBanner(
                message: st.fallbackReason!,
                onDismiss: ctrl.clearFallback,
              ),
            ),
          Expanded(
            child: TabBarView(
              controller: _tabs,
              children: [
                const _TranscriptTab(),
                _AnalyzeTab(
                  state: analysisState,
                  onAnalyze: hasUtterances ? analyze : null,
                  builder: (a) => DiagnosisView(analysis: a),
                ),
                _AnalyzeTab(
                  state: analysisState,
                  onAnalyze: hasUtterances ? analyze : null,
                  builder: (a) => TermsView(analysis: a),
                ),
                _AnalyzeTab(
                  state: analysisState,
                  onAnalyze: hasUtterances ? analyze : null,
                  builder: (a) => QuestionsView(analysis: a),
                ),
                SummaryView(
                  summary: summaryState.value,
                  busy: summaryState.isLoading,
                  onChanged: (next) => ref
                      .read(liveSummaryControllerProvider.notifier)
                      .updateLocal(next),
                  onRegenerate: hasUtterances
                      ? () => ref
                            .read(liveSummaryControllerProvider.notifier)
                            .regenerate()
                      : null,
                ),
                DictationView(
                  dictation: dictationState.value,
                  busy: dictationState.isLoading,
                  onChanged: (next) => ref
                      .read(liveDictationControllerProvider.notifier)
                      .updateLocal(next),
                  onRegenerate: hasUtterances
                      ? () => ref
                            .read(liveDictationControllerProvider.notifier)
                            .regenerate()
                      : null,
                ),
              ],
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              // 글래스 탭바 본체 높이만큼 들어올려 버튼이 가려지지 않게 한다.
              padding: EdgeInsets.fromLTRB(
                AppSpacing.lg.r,
                AppSpacing.md.h,
                AppSpacing.lg.r,
                AppSpacing.md.h + GlassNavBarLayout.navBarHeight,
              ),
              child: RecordButton(
                active: st.active,
                onPressed: () => st.active ? ctrl.stop() : ctrl.start(),
                label: st.active ? t.captureStop : t.captureStart,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 분석 계열 탭 래퍼 — 상단에 수동 "분석" 액션 바, 아래에 로딩/에러/결과 뷰.
class _AnalyzeTab extends StatelessWidget {
  const _AnalyzeTab({
    required this.state,
    required this.onAnalyze,
    required this.builder,
  });

  final AsyncValue<Analysis?> state;
  final VoidCallback? onAnalyze;
  final Widget Function(Analysis? analysis) builder;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final cs = context.colors;
    final busy = state.isLoading;

    Widget content;
    if (busy && state.value == null) {
      content = const AnalyzingIndicator();
    } else if (state.hasError && state.value == null) {
      content = Center(
        child: Padding(
          padding: EdgeInsets.all(AppSpacing.xl.r),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(LucideIcons.alertCircle, color: cs.error, size: 28.r),
              SizedBox(height: AppSpacing.sm.h),
              Text(
                state.error.toString(),
                textAlign: TextAlign.center,
                style: context.cardBody.copyWith(color: cs.onSurfaceVariant),
              ),
            ],
          ),
        ),
      );
    } else {
      content = builder(state.value);
    }

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
            child: FilledButton.tonalIcon(
              onPressed: busy ? null : onAnalyze,
              icon: busy
                  ? SizedBox(
                      width: 16.r,
                      height: 16.r,
                      child: const CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Icon(LucideIcons.sparkles, size: 16.r),
              label: Text(t.captureAnalyze),
            ),
          ),
        ),
        Expanded(child: content),
      ],
    );
  }
}

/// 캡처 화면 상단 에러 배너 — 권한 종류에 따라 다른 액션 버튼.
class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({
    required this.error,
    required this.onRetry,
    required this.onOpenSettings,
  });

  final Failure error;
  final VoidCallback onRetry;
  final VoidCallback onOpenSettings;

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);

    final (String message, Widget? action) = switch (error) {
      MicrophonePermanentlyDeniedFailure() => (
        t.micPermissionPermanentlyDenied,
        FilledButton.tonal(
          onPressed: onOpenSettings,
          child: Text(t.openSettings),
        ),
      ),
      MicrophoneDeniedFailure() => (
        t.micPermissionRequired,
        FilledButton.tonal(onPressed: onRetry, child: Text(t.sessionsRetry)),
      ),
      _ => (error.message, null),
    };

    return ActionBanner(
      message: message,
      severity: BannerSeverity.error,
      actions: [if (action != null) action],
    );
  }
}

/// Transcript 탭: 액션 툴바(스왑/저장/불러오기/지우기) + 발화 리스트 +
/// 진행 중 partial(확정 버튼 포함).
class _TranscriptTab extends ConsumerWidget {
  const _TranscriptTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final cs = context.colors;
    final st = ref.watch(captureControllerProvider);
    final ctrl = ref.read(captureControllerProvider.notifier);
    final hasUtterances = st.utterances.isNotEmpty;

    Future<void> save() async {
      await ctrl.saveNow();
      if (!context.mounted) return;
      if (ref.read(captureControllerProvider).error == null) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(t.captureSaved)));
      }
    }

    Future<void> clear() async {
      final ok = await showConfirmDialog(
        context,
        title: t.captureClearTitle,
        message: t.captureClearBody,
        confirmLabel: t.captureClear,
        cancelLabel: t.cancel,
        destructive: true,
      );
      if (ok) ctrl.clear();
    }

    return Column(
      children: [
        // 액션 툴바 — 스왑/저장/불러오기/지우기.
        Padding(
          padding: EdgeInsets.fromLTRB(
            AppSpacing.md.w,
            AppSpacing.sm.h,
            AppSpacing.md.w,
            AppSpacing.xs.h,
          ),
          child: Wrap(
            spacing: AppSpacing.sm.w,
            runSpacing: AppSpacing.xs.h,
            children: [
              _ToolChip(
                icon: LucideIcons.arrowLeftRight,
                label: t.swapSpeakers,
                onTap: hasUtterances ? ctrl.swapSpeakers : null,
              ),
              _ToolChip(
                icon: LucideIcons.save,
                label: t.captureSave,
                busy: st.saving,
                onTap: hasUtterances && !st.saving ? save : null,
              ),
              _ToolChip(
                icon: LucideIcons.folderOpen,
                label: t.captureLoad,
                onTap: () => _showLoadSheet(context),
              ),
              _ToolChip(
                icon: LucideIcons.eraser,
                label: t.captureClear,
                tint: cs.error,
                onTap: hasUtterances && !st.active ? clear : null,
              ),
            ],
          ),
        ),
        Expanded(
          child: st.utterances.isEmpty && st.partial.isEmpty
              ? EmptyView(message: t.captureEmpty, icon: LucideIcons.mic)
              : TranscriptView(
                  chunks: st.utterances,
                  onRelabel: ctrl.relabel,
                  onDelete: ctrl.removeUtterance,
                ),
        ),
        // 진행 중 partial — 말이 멈추면 자동으로 위 목록에 확정된다(무음 타이머).
        if (st.partial.isNotEmpty)
          Container(
            width: double.infinity,
            margin: EdgeInsets.all(AppSpacing.md.r),
            padding: EdgeInsets.all(AppSpacing.md.r),
            decoration: BoxDecoration(
              color: cs.surfaceContainer,
              borderRadius: AppRadius.mdAll,
            ),
            child: Row(
              children: [
                SizedBox(
                  width: 14.r,
                  height: 14.r,
                  child: const CircularProgressIndicator(strokeWidth: 2),
                ),
                SizedBox(width: AppSpacing.sm.w),
                Expanded(
                  child: Text(
                    st.partial,
                    style: context.cardBody.copyWith(
                      fontStyle: FontStyle.italic,
                      color: cs.onSurfaceVariant,
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }

  Future<void> _showLoadSheet(BuildContext context) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => const _LoadSessionSheet(),
    );
  }
}

/// 전사 툴바용 컴팩트 칩 버튼(아이콘 + 라벨). [tint] 로 파괴적 동작 강조.
class _ToolChip extends StatelessWidget {
  const _ToolChip({
    required this.icon,
    required this.label,
    required this.onTap,
    this.busy = false,
    this.tint,
  });

  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool busy;
  final Color? tint;

  @override
  Widget build(BuildContext context) {
    final cs = context.colors;
    final enabled = onTap != null;
    final fg = !enabled
        ? cs.onSurfaceVariant.withValues(alpha: 0.5)
        : (tint ?? cs.onSurface);
    return Material(
      color: (tint ?? cs.surfaceContainerHighest).withValues(
        alpha: enabled ? (tint != null ? 0.12 : 0.6) : 0.3,
      ),
      borderRadius: AppRadius.pillAll,
      child: InkWell(
        borderRadius: AppRadius.pillAll,
        onTap: onTap,
        child: Padding(
          padding: EdgeInsets.symmetric(
            horizontal: AppSpacing.md.w,
            vertical: AppSpacing.sm.h,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              busy
                  ? SizedBox(
                      width: 15.r,
                      height: 15.r,
                      child: const CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Icon(icon, size: 16.r, color: fg),
              SizedBox(width: AppSpacing.xs.w),
              Text(
                label,
                style: context.caption.copyWith(
                  color: fg,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 저장된 세션 목록에서 하나를 골라 캡처로 불러오는 바텀시트.
class _LoadSessionSheet extends ConsumerWidget {
  const _LoadSessionSheet();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final sessions = ref.watch(sessionsListControllerProvider);

    Future<void> pick(Session s) async {
      final res = await ref.read(sessionsRepositoryProvider).load(s.id);
      if (!context.mounted) return;
      switch (res) {
        case Success(value: final detail):
          ref
              .read(captureControllerProvider.notifier)
              .loadSession(
                sessionId: detail.session.id,
                chunks: detail.chunks,
                startedAt: detail.session.startedAt,
              );
          Navigator.of(context).pop();
        case FailureResult(failure: final f):
          ScaffoldMessenger.of(context)
            ..hideCurrentSnackBar()
            ..showSnackBar(SnackBar(content: Text(f.message)));
      }
    }

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.6,
      maxChildSize: 0.9,
      builder: (context, scrollController) => Column(
        children: [
          Padding(
            padding: EdgeInsets.fromLTRB(
              AppSpacing.lg.w,
              AppSpacing.sm.h,
              AppSpacing.lg.w,
              AppSpacing.sm.h,
            ),
            child: Text(
              t.loadSessionTitle,
              style: context.cardTitle.copyWith(fontWeight: FontWeight.w800),
            ),
          ),
          Expanded(
            child: sessions.when(
              loading: () =>
                  const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(child: Text(e.toString())),
              data: (list) {
                if (list.isEmpty) {
                  return EmptyView(
                    message: t.loadSessionEmpty,
                    icon: LucideIcons.inbox,
                  );
                }
                return ListView.builder(
                  controller: scrollController,
                  itemCount: list.length,
                  itemBuilder: (_, i) {
                    final s = list[i];
                    return ListTile(
                      leading: const Icon(LucideIcons.fileText),
                      title: Text(
                        s.title?.isNotEmpty == true
                            ? s.title!
                            : formatSessionStart(s.startedAt),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      subtitle: Text('${s.chunkCount}'),
                      onTap: () => pick(s),
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
