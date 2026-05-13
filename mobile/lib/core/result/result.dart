import '../error/failure.dart';

/// Result of T — Success(value) or FailureResult(failure).
/// Repository methods return this so call sites use exhaustive when() rather
/// than try/catch sprinkled everywhere.
sealed class Result<T> {
  const Result();

  bool get isSuccess => this is Success<T>;
  bool get isFailure => this is FailureResult<T>;

  T? get valueOrNull => switch (this) {
        Success(value: final v) => v,
        FailureResult() => null,
      };

  Failure? get failureOrNull => switch (this) {
        Success() => null,
        FailureResult(failure: final f) => f,
      };

  R when<R>({
    required R Function(T value) success,
    required R Function(Failure failure) failure,
  }) =>
      switch (this) {
        Success(value: final v) => success(v),
        FailureResult(failure: final f) => failure(f),
      };
}

class Success<T> extends Result<T> {
  const Success(this.value);
  final T value;
}

class FailureResult<T> extends Result<T> {
  const FailureResult(this.failure);
  final Failure failure;
}
