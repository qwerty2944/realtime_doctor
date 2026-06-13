import 'package:dio/dio.dart';
import 'package:pretty_dio_logger/pretty_dio_logger.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

import 'error_interceptor.dart';

part 'dio_provider.g.dart';

/// Bare Dio — endpoint별 Retrofit 클라이언트가 baseUrl 를 따로 지정.
@Riverpod(keepAlive: true)
Dio dio(Ref ref) {
  final dio = Dio(
    BaseOptions(
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 60),
      sendTimeout: const Duration(seconds: 30),
      headers: {'Content-Type': 'application/json'},
    ),
  );
  dio.interceptors.add(ErrorInterceptor());
  dio.interceptors.add(
    PrettyDioLogger(
      requestBody: true,
      responseBody: false,
      compact: true,
      maxWidth: 120,
    ),
  );
  return dio;
}
