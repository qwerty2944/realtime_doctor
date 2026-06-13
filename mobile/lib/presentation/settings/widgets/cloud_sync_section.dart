import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../generated/l10n/app_localizations.dart';
import '../controllers/cloud_sync_controller.dart';

/// 클라우드 동기화 토글 — [SettingsGroup] 카드 안에 들어가는 콘텐츠.
class CloudSyncSection extends ConsumerWidget {
  const CloudSyncSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context);
    final s = ref.watch(cloudSyncControllerProvider);
    final ctrl = ref.read(cloudSyncControllerProvider.notifier);

    return Column(
      children: [
        SwitchListTile(
          title: Text(t.cloudSyncEnabled),
          value: s.enabled,
          onChanged: ctrl.setEnabled,
        ),
        const Divider(height: 1, indent: 16, endIndent: 16),
        SwitchListTile(
          title: Text(t.cloudSyncSaveTranscripts),
          value: s.saveTranscripts,
          onChanged: s.enabled ? ctrl.setSaveTranscripts : null,
        ),
        const Divider(height: 1, indent: 16, endIndent: 16),
        SwitchListTile(
          title: Text(t.cloudSyncSaveAudio),
          value: s.saveAudio,
          onChanged: s.enabled ? ctrl.setSaveAudio : null,
        ),
      ],
    );
  }
}
