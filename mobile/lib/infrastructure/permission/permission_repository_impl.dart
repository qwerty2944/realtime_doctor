import 'package:permission_handler/permission_handler.dart' as ph;
import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../domain/repositories/permission_repository.dart';

part 'permission_repository_impl.g.dart';

/// `permission_handler` 패키지 캡슐. SDK 의 `PermissionStatus` 를 우리 도메인
/// enum 으로 매핑. 다른 곳에서는 이 클래스/provider 만 본다.
class PermissionRepositoryImpl implements PermissionRepository {
  const PermissionRepositoryImpl();

  @override
  Future<MicrophonePermission> microphoneStatus() async =>
      _map(await ph.Permission.microphone.status);

  @override
  Future<MicrophonePermission> requestMicrophone() async =>
      _map(await ph.Permission.microphone.request());

  @override
  Future<bool> openAppSettings() => ph.openAppSettings();

  static MicrophonePermission _map(ph.PermissionStatus s) {
    if (s.isGranted || s.isProvisional) return MicrophonePermission.granted;
    if (s.isPermanentlyDenied) return MicrophonePermission.permanentlyDenied;
    if (s.isRestricted) return MicrophonePermission.restricted;
    return MicrophonePermission.denied;
  }
}

@Riverpod(keepAlive: true)
PermissionRepository permissionRepository(Ref ref) =>
    const PermissionRepositoryImpl();
