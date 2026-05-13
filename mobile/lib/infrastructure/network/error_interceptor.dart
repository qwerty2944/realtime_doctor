import 'package:dio/dio.dart';

import '../../core/error/exceptions.dart';

class ErrorInterceptor extends Interceptor {
  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    final status = err.response?.statusCode;
    final msg =
        err.response?.statusMessage ?? err.message ?? 'Unknown network error';
    handler.reject(
      DioException(
        requestOptions: err.requestOptions,
        response: err.response,
        type: err.type,
        error: NetworkException(msg, statusCode: status),
      ),
    );
  }
}
