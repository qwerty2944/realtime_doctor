/// Domain-level failure surfaces — used as Repository/UseCase error return.
/// Plain Dart, no Flutter import (domain layer compatible).
sealed class Failure implements Exception {
  const Failure(this.message);
  final String message;

  @override
  String toString() => '$runtimeType($message)';
}

class NetworkFailure extends Failure {
  const NetworkFailure(super.message);
}

class AuthFailure extends Failure {
  const AuthFailure(super.message);
}

class ServerFailure extends Failure {
  const ServerFailure(super.message, {this.statusCode});
  final int? statusCode;
}

class PermissionFailure extends Failure {
  const PermissionFailure(super.message);
}

/// 마이크 권한이 거부됐지만 다시 요청 가능한 상태.
class MicrophoneDeniedFailure extends PermissionFailure {
  const MicrophoneDeniedFailure(super.message);
}

/// 마이크 권한이 영구거부 또는 restricted 상태 — 시스템 다이얼로그를 다시 띄울 수
/// 없고, 사용자가 iOS 설정에서 직접 켜야 함.
class MicrophonePermanentlyDeniedFailure extends PermissionFailure {
  const MicrophonePermanentlyDeniedFailure(super.message);
}

class AudioFailure extends Failure {
  const AudioFailure(super.message);
}

class UnknownFailure extends Failure {
  const UnknownFailure(super.message);
}
