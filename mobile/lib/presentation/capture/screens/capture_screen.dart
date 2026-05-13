import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../generated/l10n/app_localizations.dart';
import '../../common/empty_view.dart';
import '../../sessions/widgets/transcript_view.dart';
import '../controllers/capture_controller.dart';

class CaptureScreen extends ConsumerWidget {
  const CaptureScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final st = ref.watch(captureControllerProvider);
    final ctrl = ref.read(captureControllerProvider.notifier);

    return Scaffold(
      appBar: AppBar(title: Text(t.captureTitle)),
      body: Column(
        children: [
          if (st.error != null)
            Container(
              width: double.infinity,
              padding: EdgeInsets.all(8.r),
              color: Theme.of(context).colorScheme.errorContainer,
              child: Text(
                st.error!.message,
                style: TextStyle(
                  fontSize: 12.sp,
                  color: Theme.of(context).colorScheme.onErrorContainer,
                ),
              ),
            ),
          Expanded(
            child: st.utterances.isEmpty && st.partial.isEmpty
                ? EmptyView(message: t.captureEmpty, icon: LucideIcons.mic)
                : Column(
                    children: [
                      Expanded(child: TranscriptView(chunks: st.utterances)),
                      if (st.partial.isNotEmpty)
                        Container(
                          width: double.infinity,
                          margin: EdgeInsets.all(12.r),
                          padding: EdgeInsets.all(10.r),
                          decoration: BoxDecoration(
                            color: Theme.of(context).colorScheme.surfaceContainer,
                            borderRadius: BorderRadius.circular(10.r),
                          ),
                          child: Text(
                            st.partial,
                            style: TextStyle(
                              fontSize: 13.sp,
                              fontStyle: FontStyle.italic,
                              color: Theme.of(context).colorScheme.outline,
                            ),
                          ),
                        ),
                    ],
                  ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: EdgeInsets.all(16.r),
              child: FilledButton.icon(
                style: FilledButton.styleFrom(
                  minimumSize: Size(double.infinity, 56.h),
                  backgroundColor: st.active
                      ? Theme.of(context).colorScheme.error
                      : null,
                ),
                onPressed: () => st.active ? ctrl.stop() : ctrl.start(),
                icon: Icon(st.active ? LucideIcons.micOff : LucideIcons.mic),
                label: Text(st.active ? t.captureStop : t.captureStart),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
