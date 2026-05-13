import 'package:riverpod_annotation/riverpod_annotation.dart';

import '../../../infrastructure/network/dio_provider.dart';
import 'gemini_api.dart';

part 'gemini_api_provider.g.dart';

@Riverpod(keepAlive: true)
GeminiApi geminiApi(GeminiApiRef ref) {
  return GeminiApi(ref.watch(dioProvider));
}
