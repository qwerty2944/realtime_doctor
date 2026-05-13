import 'package:dio/dio.dart';

/// Gemini Generative Language API — analyzer / summarizer / dictator /
/// diarizer 호출용. Retrofit 대신 Dio 직접 사용 (한 군데뿐이라 codegen 가치 낮음).
class GeminiApi {
  GeminiApi(this._dio);

  final Dio _dio;

  static const _base = 'https://generativelanguage.googleapis.com/v1beta';

  Future<Map<String, dynamic>> generate(
    String model,
    String apiKey,
    Map<String, dynamic> body,
  ) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '$_base/models/${Uri.encodeComponent(model)}:generateContent',
      queryParameters: {'key': apiKey},
      data: body,
    );
    return res.data ?? <String, dynamic>{};
  }
}
