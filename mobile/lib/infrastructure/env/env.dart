import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'env.g.dart';

class AppEnv {
  const AppEnv({
    required this.supabaseUrl,
    required this.supabaseAnonKey,
    required this.geminiApiKey,
    required this.geminiTranscribeModel,
    required this.clovaSpeechSecret,
    required this.openaiApiKey,
    required this.openaiTranscribeModel,
  });

  final String supabaseUrl;
  final String supabaseAnonKey;
  final String geminiApiKey;
  final String geminiTranscribeModel;
  final String clovaSpeechSecret;
  final String openaiApiKey;
  final String openaiTranscribeModel;

  factory AppEnv.fromDotenv() {
    return AppEnv(
      supabaseUrl: dotenv.env['SUPABASE_URL'] ?? '',
      supabaseAnonKey: dotenv.env['SUPABASE_ANON_KEY'] ?? '',
      geminiApiKey: dotenv.env['GEMINI_API_KEY'] ?? '',
      geminiTranscribeModel:
          dotenv.env['GEMINI_TRANSCRIBE_MODEL'] ?? 'gemini-2.5-flash',
      clovaSpeechSecret: dotenv.env['CLOVA_SPEECH_SECRET'] ?? '',
      openaiApiKey: dotenv.env['OPENAI_API_KEY'] ?? '',
      openaiTranscribeModel:
          dotenv.env['OPENAI_TRANSCRIBE_MODEL'] ?? 'gpt-4o-transcribe',
    );
  }
}

@Riverpod(keepAlive: true)
AppEnv env(Ref ref) => AppEnv.fromDotenv();
