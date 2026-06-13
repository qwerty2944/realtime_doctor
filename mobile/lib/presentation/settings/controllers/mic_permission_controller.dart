import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../domain/repositories/permission_repository.dart';
import '../../../infrastructure/permission/permission_repository_impl.dart';

part 'mic_permission_controller.g.dart';

/// 설정 화면용 마이크 권한 상태 컨트롤러.
/// 도메인 [PermissionRepository](permission_handler 캡슐)를 Riverpod 으로 주입받아
/// 현재 상태를 노출하고, 요청/설정-열기 액션을 제공한다.
@riverpod
class MicPermissionController extends _$MicPermissionController {
  PermissionRepository get _repo => ref.read(permissionRepositoryProvider);

  @override
  Future<MicrophonePermission> build() => _repo.microphoneStatus();

  /// 거부 상태면 시스템 다이얼로그로 요청, 영구거부/제한이면 설정 앱을 연다.
  Future<void> requestOrOpenSettings() async {
    final current = await _repo.microphoneStatus();
    if (current == MicrophonePermission.denied) {
      final next = await _repo.requestMicrophone();
      state = AsyncData(next);
      if (next == MicrophonePermission.granted) return;
    }
    if (current == MicrophonePermission.permanentlyDenied ||
        current == MicrophonePermission.restricted) {
      await _repo.openAppSettings();
    }
    // 다이얼로그/설정 복귀 후 최신 상태로 갱신.
    state = AsyncData(await _repo.microphoneStatus());
  }

  /// iOS 설정 앱에서 돌아왔을 때 등 상태를 다시 읽는다.
  Future<void> refresh() async {
    state = AsyncData(await _repo.microphoneStatus());
  }
}
