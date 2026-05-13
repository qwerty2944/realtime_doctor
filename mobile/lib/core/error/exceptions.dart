/// Low-level exceptions thrown from datasources / infra.
/// Repositories catch these and map to [Failure].
class NetworkException implements Exception {
  const NetworkException(this.message, {this.statusCode});
  final String message;
  final int? statusCode;

  @override
  String toString() => 'NetworkException($statusCode: $message)';
}

class AuthException implements Exception {
  const AuthException(this.message);
  final String message;

  @override
  String toString() => 'AuthException($message)';
}

class AudioException implements Exception {
  const AudioException(this.message);
  final String message;

  @override
  String toString() => 'AudioException($message)';
}
