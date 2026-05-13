import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/utils/date_format.dart';
import '../../../generated/l10n/app_localizations.dart';
import '../../common/error_view.dart';
import '../../common/loading_view.dart';
import '../controllers/session_detail_controller.dart';
import '../widgets/analysis_view.dart';
import '../widgets/audio_player_bar.dart';
import '../widgets/dictation_view.dart';
import '../widgets/summary_view.dart';
import '../widgets/transcript_view.dart';

class SessionDetailScreen extends ConsumerWidget {
  const SessionDetailScreen({required this.id, super.key});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final state = ref.watch(sessionDetailControllerProvider(id));
    return DefaultTabController(
      length: 5,
      child: Scaffold(
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
          bottom: TabBar(
            isScrollable: true,
            tabs: [
              Tab(text: t.tabTranscript),
              Tab(text: t.tabAnalysis),
              Tab(text: t.tabSummary),
              Tab(text: t.tabDictation),
              Tab(text: t.tabAudio),
            ],
          ),
        ),
        body: state.when(
          loading: () => const LoadingView(),
          error: (e, _) => ErrorView(
            message: e.toString(),
            onRetry: () =>
                ref.invalidate(sessionDetailControllerProvider(id)),
          ),
          data: (d) => TabBarView(
            children: [
              TranscriptView(chunks: d.chunks),
              AnalysisView(analysis: d.analysis),
              SummaryView(summary: d.summary),
              DictationView(dictation: d.dictation),
              AudioPlayerBar(signedUrl: d.signedAudioUrl),
            ],
          ),
        ),
      ),
    );
  }
}
