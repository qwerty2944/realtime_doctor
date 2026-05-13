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

class AudioFailure extends Failure {
  const AudioFailure(super.message);
}

class UnknownFailure extends Failure {
  const UnknownFailure(super.message);
}
