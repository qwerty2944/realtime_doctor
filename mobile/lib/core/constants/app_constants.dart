class AppConstants {
  AppConstants._();

  static const String appName = 'Realtime Doctor';
  static const int audioSampleRate = 16000;
  static const int audioChannels = 1;
  static const int audioBitsPerSample = 16;

  // Supabase tables
  static const String tableSessions = 'sessions';
  static const String tableTranscriptChunks = 'transcript_chunks';
  static const String tableAnalyses = 'analyses';
  static const String tableSummaries = 'summaries';
  static const String tableDictations = 'dictations';

  // Storage buckets
  static const String bucketRecordings = 'recordings';

  // Models
  static const String geminiAnalyzerModel = 'gemini-2.5-flash';
  static const String geminiDiarizerModel = 'gemini-2.5-flash';
}
