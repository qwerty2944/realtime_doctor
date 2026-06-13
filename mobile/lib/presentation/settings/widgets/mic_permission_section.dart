import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_screenutil/flutter_screenutil.dart';
import 'package:lucide_icons/lucide_icons.dart';

import '../../../app/theme.dart';
import '../../../domain/repositories/permission_repository.dart';
import '../../../generated/l10n/app_localizations.dart';
import '../controllers/mic_permission_controller.dart';

/// 마이크 권한 상태 + 요청/설정-열기 버튼. [SettingsGroup] 카드 안에 들어간다.
/// iOS 설정 앱에서 돌아오면(앱 resume) 상태를 자동 갱신한다.
class MicPermissionSection extends ConsumerStatefulWidget {
  const MicPermissionSection({super.key});

  @override
  ConsumerState<MicPermissionSection> createState() =>
      _MicPermissionSectionState();
}

class _MicPermissionSectionState extends ConsumerState<MicPermissionSection>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      ref.read(micPermissionControllerProvider.notifier).refresh();
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context);
    final cs = context.colors;
    final asyncStatus = ref.watch(micPermissionControllerProvider);
    final status = asyncStatus.value;
    final granted = status == MicrophonePermission.granted;

    final (String label, Color color) = switch (status) {
      MicrophonePermission.granted => (t.micStatusGranted, cs.primary),
      MicrophonePermission.denied => (t.micStatusDenied, cs.onSurfaceVariant),
      MicrophonePermission.permanentlyDenied => (
        t.micStatusPermanentlyDenied,
        cs.error,
      ),
      MicrophonePermission.restricted => (t.micStatusRestricted, cs.error),
      null => ('…', cs.onSurfaceVariant),
    };

    return ListTile(
      leading: Icon(
        granted ? LucideIcons.mic : LucideIcons.micOff,
        color: granted ? cs.primary : cs.outline,
      ),
      title: Text(t.micPermission),
      subtitle: Text(label, style: context.caption.copyWith(color: color)),
      trailing: granted
          ? Icon(LucideIcons.checkCircle2, color: cs.primary, size: 22.r)
          : FilledButton.tonal(
              onPressed: status == null
                  ? null
                  : () => ref
                        .read(micPermissionControllerProvider.notifier)
                        .requestOrOpenSettings(),
              child: Text(
                status == MicrophonePermission.permanentlyDenied ||
                        status == MicrophonePermission.restricted
                    ? t.openSettings
                    : t.micAllow,
              ),
            ),
    );
  }
}
