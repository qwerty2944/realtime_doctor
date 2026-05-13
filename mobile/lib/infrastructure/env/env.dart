import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:riverpod_annotation/riverpod_annotation.dart';

part 'env.g.dart';

class AppEnv {
  const AppEnv({
    required this.supabaseUrl,
    required this.supabaseAnonKey,
    required this.geminiApiKey,
    required this.clovaSpeechSecret,
    required this.openaiApiKey,
  });

  final String supabaseUrl;
  final String supabaseAnonKey;
  final String geminiApiKey;
  final String clovaSpeechSecret;
  final String openaiApiKey;

  factory AppEnv.fromDotenv() {
    return AppEnv(
      supabaseUrl: dotenv.env['SUPABASE_URL'] ?? '',
      supabaseAnonKey: dotenv.env['SUPABASE_ANON_KEY'] ?? '',
      geminiApiKey: dotenv.env['GEMINI_API_KEY'] ?? '',
      clovaSpeechSecret: dotenv.env['CLOVA_SPEECH_SECRET'] ?? '',
      openaiApiKey: dotenv.env['OPENAI_API_KEY'] ?? '',
    );
  }
}

@Riverpod(keepAlive: true)
AppEnv env(EnvRef ref) => AppEnv.fromDotenv();
