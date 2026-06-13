/// 도메인 레벨 마이크 권한 상태.
///
/// `permission_handler` 패키지의 PermissionStatus 를 그대로 노출하지 않고
/// 우리 앱이 신경 쓰는 4개 케이스로 좁힌다. UI 는 이 enum 으로 분기.
enum MicrophonePermission {
  granted,
  denied,
  permanentlyDenied,
  restricted,
}

/// 권한 SDK 를 캡슐화하는 도메인 인터페이스.
///
/// Plain Dart, no Flutter import — 도메인 layer 컨벤션 유지.
abstract interface class PermissionRepository {
  Future<MicrophonePermission> microphoneStatus();

  /// 시스템 다이얼로그를 띄울 수 있을 때만 띄움. 영구거부 상태면 다이얼로그 없이
  /// 현재 상태(`permanentlyDenied`) 그대로 반환.
  Future<MicrophonePermission> requestMicrophone();

  /// iOS 설정 앱 열기 — 영구거부 복구 경로.
  Future<bool> openAppSettings();
}
